"""Keep the committed MuJoCo models aligned with the RS SDK inertial model."""
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
URDF = ROOT / "RS/urdf/ReBot_Arm_RS.urdf"
MODELS = ROOT / "rebotarm_mujoco_rs/models"
LINKS = ("base_link", "link1", "link2", "link3", "link4", "link5",
         "link6", "gripper_end", "gripper_left", "gripper_right")


def vector(value):
    return [float(x) for x in value.split()]


class TestModelConsistency(unittest.TestCase):
    def test_inertials_and_gripper(self):
        urdf = ET.parse(URDF).getroot()
        models = ("rs_arm.xml", "rs_agv_scene.xml", "rs_agv_campus_scene.xml",
                  "rs_dual_tabletop_scene.xml")
        for filename in models:
            root = ET.parse(MODELS / filename).getroot()
            prefixes = ("left_", "right_") if "dual" in filename else ("",)
            for prefix in prefixes:
                for name in LINKS:
                    with self.subTest(model=filename, link=prefix + name):
                        source = urdf.find(f"./link[@name='{name}']/inertial")
                        actual = root.find(f".//body[@name='{prefix + name}']/inertial")
                        self.assertIsNotNone(source)
                        self.assertIsNotNone(actual)
                        self.assertAlmostEqual(float(source.find("mass").get("value")),
                                               float(actual.get("mass")), delta=1e-8)
                        for a, b in zip(vector(source.find("origin").get("xyz")),
                                        vector(actual.get("pos"))):
                            self.assertAlmostEqual(a, b, delta=1e-7)
                        source_i = source.find("inertia")
                        expected = [float(source_i.get(k)) for k in
                                    ("ixx", "iyy", "izz", "ixy", "ixz", "iyz")]
                        if actual.get("fullinertia") is not None:
                            result = vector(actual.get("fullinertia"))
                        else:
                            result = vector(actual.get("diaginertia")) + [0., 0., 0.]
                        self.assertEqual(len(result), 6)
                        for a, b in zip(expected, result):
                            self.assertAlmostEqual(a, b, delta=1e-8)
                for name in ("joint7", "joint_left", "joint_right"):
                    j = root.find(f".//joint[@name='{prefix + name}']")
                    self.assertIsNotNone(j, (filename, prefix + name))
                    self.assertEqual(vector(j.get("range")), [0., .05])
                for side in ("joint_left", "joint_right"):
                    matches = [j for j in root.findall("./equality/joint")
                               if j.get("joint1") == prefix + "joint7"
                               and j.get("joint2") == prefix + side]
                    self.assertEqual(len(matches), 1, (filename, prefix + side))
                    self.assertEqual(vector(matches[0].get("polycoef")), [0., 1., 0., 0., 0.])


if __name__ == "__main__":
    unittest.main()
