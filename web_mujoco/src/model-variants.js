import { CAMPUS_LAYOUT } from './campus-layout.js';

export const MODEL_VARIANTS = Object.freeze({
  dual: Object.freeze({
    id: 'dual',
    sceneXml: 'rs_dual_tabletop_scene.xml',
    labelKey: 'variant.dual',
    hasAgv: false,
    view: Object.freeze({
      environment: 'home',
      position: [1.8, 1.25, 1.95],
      target: [0.24, 0, 0.83],
      // Stay on the table side of the floor lamp in front of the side wall.
      maxCameraY: 1.60,
      // Z-up orbit: include the right side of the table so the coffee machine
      // stays clear of the arms. Keep the camera in front of the back wall.
      orbit: Object.freeze({
        minAzimuthAngle: Math.PI * 25 / 180,
        maxAzimuthAngle: Math.PI * 150 / 180,
        minPolarAngle: Math.PI / 120,
        maxPolarAngle: Math.PI * 75 / 180,
        minDistance: 1.25,
        maxDistance: 4.8,
        enablePan: false,
        rotateSpeed: .65,
        zoomSpeed: .8
      }),
      near: 0.04,
      far: 20
    })
  }),
  arm: Object.freeze({
    id: 'arm',
    sceneXml: 'rs_grasp_scene.xml',
    labelKey: 'variant.arm',
    hasAgv: false,
    view: Object.freeze({
      position: [0.85, -0.95, 0.62],
      target: [0.28, 0, 0.16],
      far: 20
    })
  }),
  agv: Object.freeze({
    id: 'agv',
    sceneXml: 'rs_agv_scene.xml',
    labelKey: 'variant.agv',
    hasAgv: true,
    view: Object.freeze({
      position: [5.8, -6.8, 4.8],
      target: [0, 0, 0.35],
      near: 0.08,
      far: 30
    })
  }),
  'agv-campus': Object.freeze({
    id: 'agv-campus',
    sceneXml: 'rs_agv_campus_scene.xml',
    labelKey: 'variant.agvCampus',
    hasAgv: true,
    navigation: CAMPUS_LAYOUT,
    view: CAMPUS_LAYOUT.view
  })
});

export function selectedModelVariant(search = window.location.search) {
  const id = new URLSearchParams(search).get('variant');
  return MODEL_VARIANTS[id] || MODEL_VARIANTS.arm;
}

export function switchModelVariant(id) {
  const variant = MODEL_VARIANTS[id] || MODEL_VARIANTS.arm;
  const url = new URL(window.location.href);
  url.searchParams.set('variant', variant.id);
  window.location.assign(url);
}
