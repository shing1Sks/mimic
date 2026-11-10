// Attach the r149 example loaders to the global THREE, then announce readiness.
import { GLTFLoader } from './GLTFLoader.js';
import { RGBELoader } from './RGBELoader.js';
import * as SkeletonUtils from './SkeletonUtils.js';
THREE.GLTFLoader = GLTFLoader;
THREE.RGBELoader = RGBELoader;
THREE.SkeletonUtils = SkeletonUtils;
window.__threeLoadersReady = true;
window.dispatchEvent(new Event('three-loaders'));
