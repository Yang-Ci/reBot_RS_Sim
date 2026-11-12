"""Control lifecycle regressions without a running ROS graph or physics engine.

Only transport/numerical imports are stubbed. Tests execute the actual driver
callbacks, timer and task ownership/cancellation methods.
"""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import math
from pathlib import Path
import sys
import threading
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch


SOURCE = Path(__file__).resolve().parents[1] / "rebotarm_mujoco_rs"


def load_nodes():
    package = ModuleType("_rebot_safety_test")
    package.__path__ = [str(SOURCE)]
    modules = {package.__name__: package}
    for name in (
        "rclpy", "rclpy.executors", "rclpy.node", "rclpy.qos", "rclpy.action",
        "rclpy.callback_groups", "rebotarm_msgs.msg", "rebotarm_msgs.srv",
        "rebotarm_msgs.action", "sensor_msgs.msg", "std_srvs.srv",
        "control_msgs.action", "geometry_msgs.msg", "trajectory_msgs.msg",
        "mujoco", "numpy", "scipy.optimize", "scipy.spatial.transform",
        "_rebot_safety_test.mujoco_sync",
    ):
        modules[name] = MagicMock()
    modules["rclpy.node"].Node = object
    modules["rclpy.action"].GoalResponse = SimpleNamespace(ACCEPT=1, REJECT=0)
    modules["rclpy.action"].CancelResponse = SimpleNamespace(ACCEPT=1, REJECT=0)
    modules["numpy"].array.side_effect = lambda values: list(values)
    result = []
    with patch.dict(sys.modules, modules):
        for name in ("rs_driver", "task_server"):
            qualified = f"{package.__name__}.{name}"
            spec = importlib.util.spec_from_file_location(qualified, SOURCE / f"{name}.py")
            module = importlib.util.module_from_spec(spec)
            sys.modules[qualified] = module
            spec.loader.exec_module(module)
            result.append(module)
    return result


driver_module, task_module = load_nodes()
Driver = driver_module.RsDriver
TaskServer = task_module.RsTaskServer


class Stamp:
    def __sub__(self, other):
        return SimpleNamespace(nanoseconds=100_000_000)


class DriverSafety(unittest.TestCase):
    def setUp(self):
        self.driver = d = Driver.__new__(Driver)
        d._lock = threading.RLock()
        d.enabled = True
        d.positions = [.2] * 6
        d.targets = [1.] * 6
        d.velocities = [.5] * 6
        d.gripper_position, d.gripper_target, d.gripper_velocity = .3, 2., .5
        d.gripper_open_position = 5.
        d.max_joint_speed = d.max_gripper_speed = 1.
        d.last_time = Stamp()
        d.get_clock = lambda: SimpleNamespace(now=Stamp)
        d._publish_status = MagicMock()
        d._publish_states = MagicMock()

    def test_disable_holds_feedback_and_discards_old_targets(self):
        d = self.driver
        d._disable(None, SimpleNamespace())
        for _ in range(5):
            d._tick()
        self.assertEqual(d.positions, [.2] * 6)
        self.assertEqual(d.gripper_position, .3)
        self.assertEqual(d.velocities, [0.] * 6)
        self.assertEqual(d.gripper_velocity, 0.)
        self.assertEqual(d._publish_states.call_count, 5)
        # Commands/home while disabled cannot leave a target for re-enable.
        d._joint_command_callback(0)(SimpleNamespace(pos=1.5))
        d._gripper_command_callback(SimpleNamespace(pos=4.))
        self.assertFalse(d._safe_home(None, SimpleNamespace()).success)
        self.assertFalse(d._open_gripper(SimpleNamespace(position=0.), SimpleNamespace()).success)
        d._enable(None, SimpleNamespace())
        d._tick()
        self.assertEqual(d.positions, [.2] * 6)
        self.assertEqual(d.gripper_position, .3)
        d._joint_command_callback(0)(SimpleNamespace(pos=.8))
        d._gripper_command_callback(SimpleNamespace(pos=1.))
        d._tick()
        self.assertAlmostEqual(d.positions[0], .3)
        self.assertAlmostEqual(d.gripper_position, .4)

    def test_nonfinite_commands_never_change_targets(self):
        d = self.driver
        for value in (math.nan, math.inf, -math.inf):
            with self.subTest(value=value):
                d._joint_command_callback(0)(SimpleNamespace(pos=value))
                d._gripper_command_callback(SimpleNamespace(pos=value))
                self.assertEqual(d.targets[0], 1.)
                self.assertEqual(d.gripper_target, 2.)
                for handler in (d._set_gripper, d._open_gripper, d._close_gripper):
                    response = handler(SimpleNamespace(position=value), SimpleNamespace())
                    self.assertFalse(response.success)
                    self.assertEqual(response.reached_position, 2.)
                with self.assertRaises(ValueError):
                    d._clamp(value, -1., 1.)

    def test_finite_commands_preserve_limits_and_open_default(self):
        d = self.driver
        d._joint_command_callback(0)(SimpleNamespace(pos=100.))
        self.assertEqual(d.targets[0], 2.8)
        response = d._open_gripper(SimpleNamespace(position=0.), SimpleNamespace())
        self.assertTrue(response.success)
        self.assertEqual(d.gripper_target, 5.)
        d._safe_home(None, SimpleNamespace())
        self.assertEqual(d.targets, [0.] * 6)


class MotionOwnership(unittest.TestCase):
    def setUp(self):
        self.server = s = TaskServer.__new__(TaskServer)
        s._motion_lock = threading.Lock()
        s._state_lock = threading.RLock()
        s._motion_busy = False
        s._active_goal = None
        s._cancel = threading.Event()
        s._record_samples = [{"t": t, **{f"joint{i}": t for i in range(1, 7)}} for t in (0., 1.)]
        s._recording = False
        s.get_logger = MagicMock()

    def test_atomic_reservation_includes_queued_goals_and_replays(self):
        s = self.server
        barrier = threading.Barrier(12)
        def accept(_):
            barrier.wait()
            return s._accept_goal(None)
        with ThreadPoolExecutor(max_workers=12) as executor:
            responses = list(executor.map(accept, range(12)))
        self.assertEqual(responses.count(1), 1)
        self.assertFalse(s._record_replay(None, SimpleNamespace()).success)
        s._release_motion()
        self.assertEqual(s._accept_goal(None), 1)

    def test_cancellation_before_execution_is_not_cleared(self):
        s = self.server
        s._reserve_motion()
        goal = MagicMock()
        s._handle_accepted(goal)
        self.assertEqual(s._accept_cancel(goal), 1)
        self.assertFalse(s._cancel.is_set())
        # The ROS server commits CANCELING after the cancel callback returns.
        goal.is_cancel_requested = True
        s.command_hz = 60.
        self.assertFalse(s._run_path([[0.], [1.]], [0., 1.], goal_handle=goal))
        self.assertTrue(goal.is_cancel_requested)
        self.assertEqual(s._accept_cancel(MagicMock()), 0)

    def test_clear_before_replay_thread_starts_preserves_stop(self):
        s = self.server
        with patch.object(task_module.threading, "Thread") as thread:
            self.assertTrue(s._record_replay(None, SimpleNamespace()).success)
            self.assertEqual(s._accept_goal(None), 0)
            s._record_clear(None, SimpleNamespace())
            s.command_hz = 60.
            s._wait_for_settle = MagicMock()
            call = thread.call_args.kwargs
            call["target"](*call["args"])
            s._wait_for_settle.assert_not_called()
        self.assertFalse(s._motion_busy)
        self.assertEqual(s._accept_goal(None), 1)
        self.assertFalse(s._cancel.is_set())

    def test_action_exceptions_and_rejected_replays_release_slot(self):
        s = self.server
        for kind in ("move", "trajectory"):
            s._reserve_motion()
            setattr(s, f"_execute_{kind}_owned", MagicMock(side_effect=RuntimeError("failed")))
            with self.assertRaises(RuntimeError):
                getattr(s, f"_execute_{kind}")(MagicMock())
            self.assertFalse(s._motion_busy)
        s._record_samples = []
        self.assertFalse(s._record_replay(None, SimpleNamespace()).success)
        self.assertFalse(s._motion_busy)

    def test_replay_keeps_slot_until_settled_and_releases_on_failure(self):
        s = self.server
        for fail in (False, True):
            s._reserve_motion()
            s._run_path = MagicMock(return_value=True)
            def settle(_):
                self.assertEqual(s._accept_goal(None), 0)
                if fail:
                    raise RuntimeError("settle failed")
                return True, ""
            s._wait_for_settle = settle
            s._run_replay([[0.], [1.]], [0., 1.])
            self.assertFalse(s._motion_busy)

    def test_action_completion_and_schedule_failure_release_slot(self):
        s = self.server
        for kind in ("move", "trajectory"):
            s._reserve_motion()
            owned = MagicMock(return_value="result")
            setattr(s, f"_execute_{kind}_owned", owned)
            self.assertEqual(getattr(s, f"_execute_{kind}")(MagicMock()), "result")
            self.assertFalse(s._motion_busy)
        s._reserve_motion()
        old_goal = MagicMock()
        old_goal.execute.side_effect = RuntimeError("executor unavailable")
        with self.assertRaises(RuntimeError):
            s._handle_accepted(old_goal)
        self.assertFalse(s._motion_busy)
        s._reserve_motion()
        s._handle_accepted(MagicMock())
        self.assertEqual(s._accept_cancel(old_goal), 0)
        self.assertFalse(s._cancel.is_set())

    def test_thread_start_failure_releases_reservation(self):
        s = self.server
        with patch.object(task_module.threading, "Thread") as thread:
            thread.return_value.start.side_effect = RuntimeError("no thread")
            with self.assertRaises(RuntimeError):
                s._record_replay(None, SimpleNamespace())
        self.assertFalse(s._motion_busy)


if __name__ == "__main__":
    unittest.main()
