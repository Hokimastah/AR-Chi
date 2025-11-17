// Impor library Three.js
import * as THREE from 'https://cdn.skypack.dev/three@0.136';
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.136/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://cdn.skypack.dev/three@0.136/examples/jsm/loaders/GLTFLoader.js';

// --- Variabel Global ---
let camera, scene, renderer;
let controls; // Untuk OrbitControls di mode VR
let xrSession = null;
let xrRefSpace = null;
let xrHitTestSource = null;

let reticleMesh; // Objek 3D untuk indikator di lantai
let placementIndicator; // Elemen UI reticle (lingkaran putih)

let exteriorModel = null; // Grup untuk model maket eksterior
let interiorModel = null; // Grup untuk model interior
let raycaster; 
 
// Variabel untuk gestur
let initialPinchDistance = 0;
let baseScale = 1;
let initialTwistAngle = 0;
let baseRotationY = 0;
 
let currentMode = 'NONE';

const loader = new GLTFLoader();

// Referensi Elemen UI
const ui = {
   container: document.getElementById('app-container'),
   overlay: document.getElementById('ui-overlay'),
   startButton: document.getElementById('start-ar-button'),
   floorSelection: document.getElementById('floor-selection'),
   exitVrButton: document.getElementById('exit-vr-button'),
   statusMessage: document.getElementById('status-message'),
   reticleUI: document.getElementById('reticle'),
};

// --- Fungsi Helper ---

/**
 * Membersihkan memori (Geometri, Material, Tekstur) dari model GLTF
 */
function disposeGltf(gltfScene) {
   if (!gltfScene) return;

   gltfScene.traverse((object) => {
       if (object.isMesh) {
           if (object.geometry) {
               object.geometry.dispose();
           }
           if (object.material) {
               // Jika material adalah array (MultiMaterial)
               if (Array.isArray(object.material)) {
                   object.material.forEach(material => {
                       if (material.map) material.map.dispose(); // Hapus tekstur
                       material.dispose();
                   });
               } else {
                   // Jika material tunggal
                   if (object.material.map) object.material.map.dispose(); // Hapus tekstur
                   object.material.dispose();
               }
           }
       }
   });
   // Terakhir, hapus objek itu sendiri dari scene
   scene.remove(gltfScene);
}


// --- Fungsi Utama ---

// 1. Inisialisasi Aplikasi
function init() {
   // Setup scene dasar
   scene = new THREE.Scene();

   // Setup kamera
   camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    
   // Setup renderer
   renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
   renderer.setSize(window.innerWidth, window.innerHeight);
   renderer.setPixelRatio(window.devicePixelRatio);
   renderer.xr.enabled = true;
   ui.container.appendChild(renderer.domElement);

   // Setup pencahayaan
   const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
   scene.add(ambientLight);
   const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
   directionalLight.position.set(1, 2, 0);
   scene.add(directionalLight);

   // Setup Reticle 3D (mesh)
   const reticleGeo = new THREE.RingGeometry(0.1, 0.12, 32).rotateX(-Math.PI / 2);
   const reticleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
   reticleMesh = new THREE.Mesh(reticleGeo, reticleMat);
   reticleMesh.matrixAutoUpdate = false;
   reticleMesh.visible = false;
   scene.add(reticleMesh);
    
   // Setup Raycaster
   raycaster = new THREE.Raycaster();
    
   // Referensi ke Reticle UI (HTML)
   placementIndicator = ui.reticleUI;

   // Event Listeners
   ui.startButton.addEventListener('click', onStartAR);
   ui.exitVrButton.addEventListener('click', onExitVR);
    
   ui.floorSelection.querySelectorAll('button').forEach(button => {
       button.addEventListener('click', (e) => {
           const floor = e.target.dataset.floor;
           onEnterVR(floor);
       });
   });

   window.addEventListener('resize', onWindowResize);
    
   // Listener Gestur AR
   ui.container.addEventListener('touchstart', onTouchStart, { passive: false });
   ui.container.addEventListener('touchmove', onTouchMove, { passive: false });
   ui.container.addEventListener('touchend', onTouchEnd);
    
   console.log("Aplikasi siap. Menunggu 'Mulai AR'.");
}

// 2. Handler Saat Jendela di-resize
function onWindowResize() {
   camera.aspect = window.innerWidth / window.innerHeight;
   camera.updateProjectionMatrix();
   renderer.setSize(window.innerWidth, window.innerHeight);
}

// 3. Memulai Sesi AR
async function onStartAR() {
   if (!navigator.xr) {
       ui.statusMessage.textContent = 'WebXR tidak didukung di browser ini.';
       ui.statusMessage.classList.remove('hidden');
       return;
   }

   try {
       xrSession = await navigator.xr.requestSession('immersive-ar', {
           requiredFeatures: ['hit-test', 'dom-overlay'],
           domOverlay: { root: ui.overlay }
       });

       await renderer.xr.setSession(xrSession);
       xrRefSpace = await xrSession.requestReferenceSpace('local');
        
       const viewerSpace = await xrSession.requestReferenceSpace('viewer');
       xrHitTestSource = await xrSession.requestHitTestSource({ space: viewerSpace });
        
       xrSession.addEventListener('end', onAREnd);
       xrSession.addEventListener('select', onARSelect);
        
       // Ganti UI
       ui.startButton.classList.add('hidden');
       ui.statusMessage.textContent = 'Pindai permukaan datar...';
       ui.statusMessage.classList.remove('hidden');
       placementIndicator.classList.remove('hidden');
       reticleMesh.visible = true;
       currentMode = 'AR_PLACING';
        
       renderer.setAnimationLoop(renderARFrame);

   } catch (e) {
       console.error("Gagal memulai sesi AR:", e);
       ui.statusMessage.textContent = 'Gagal memulai sesi AR.';
       ui.statusMessage.classList.remove('hidden');
   }
}

// 4. Loop Render AR
function renderARFrame(timestamp, frame) {
   if (!frame) return;

   const hitTestResults = frame.getHitTestResults(xrHitTestSource);
    
   if (hitTestResults.length > 0) {
       const hit = hitTestResults[0];
       const hitPose = hit.getPose(xrRefSpace);
        
       reticleMesh.matrix.fromArray(hitPose.transform.matrix);
       reticleMesh.visible = true;
       placementIndicator.classList.remove('hidden');
   } else {
       reticleMesh.visible = false;
       placementIndicator.classList.add('hidden');
   }

   renderer.render(scene, camera);
}

// 5. Handler Saat Layar di-Tap di Mode AR
function onARSelect(event) {
    
   if (currentMode === 'AR_PLACING' && reticleMesh.visible) {
       // --- Mode Penempatan Objek ---
       
       if (!exteriorModel) {
           // **GANTI NAMA FILE INI** dengan nama file maket eksterior Anda
           loader.load('rumah.glb', (gltf) => {
               exteriorModel = gltf.scene; // Model Anda

               // Atur posisi dan rotasi model ke posisi reticle
               exteriorModel.position.setFromMatrixPosition(reticleMesh.matrix);
               exteriorModel.quaternion.setFromRotationMatrix(reticleMesh.matrix);

               // **PENTING: ATUR SKALA MODEL ANDA DI SINI**
               exteriorModel.scale.set(0.1, 0.1, 0.1); 
               
               scene.add(exteriorModel);
               
               // Ganti mode
               currentMode = 'AR_VIEWING';
               
               // Sembunyikan reticle
               reticleMesh.visible = false;
               placementIndicator.classList.add('hidden');
               ui.statusMessage.classList.add('hidden');
               
               // Tampilkan tombol pilihan lantai
               ui.floorSelection.classList.remove('hidden');

           }, undefined, (error) => {
               console.error('Gagal memuat model eksterior:', error);
               ui.statusMessage.textContent = 'Gagal memuat model.';
               ui.statusMessage.classList.remove('hidden');
           });
       }

   } else if (currentMode === 'AR_VIEWING') {
       // --- Mode Seleksi / Hapus Objek ---
       const frame = event.frame;
       const inputSource = event.inputSource;

       if (frame && inputSource && exteriorModel) {
           const pose = frame.getPose(inputSource.targetRaySpace, xrRefSpace);
           if (pose) {
               // PERBAIKAN DI SINI: Atur raycaster secara manual dari pose
               const origin = new THREE.Vector3().setFromMatrixPosition(pose.transform.matrix);
               const direction = new THREE.Vector3(0, 0, -1); // Arah "maju" dari ray
               const rotationMatrix = new THREE.Matrix4().extractRotation(pose.transform.matrix);
               direction.applyMatrix4(rotationMatrix); // Transformasikan arah ke world space
  nbsp;        
               raycaster.set(origin, direction);
               
               const intersects = raycaster.intersectObject(exteriorModel, true); // true untuk cek turunan
                
               if (intersects.length > 0) {
                   // Objek terseleksi! Hapus.
                   // PERBAIKAN: Gunakan disposeGltf untuk membersihkan memori
                   disposeGltf(exteriorModel); 
                   exteriorModel = null;
                    
                   // Kembali ke mode placing
                   currentMode = 'AR_PLACING';
                    
                   // Reset UI
                   ui.floorSelection.classList.add('hidden');
                   ui.statusMessage.textContent = 'Pindai permukaan datar...';
                   ui.statusMessage.classList.remove('hidden');
               }
           }
       }
   }
}

// 6. Handler Saat Sesi AR Berakhir
function onAREnd() {
   console.log("Sesi AR berakhir.");
   currentMode = 'NONE';
   xrSession = null;
   xrHitTestSource = null;
    
   // PERBAIKAN: Gunakan disposeGltf
   if (exteriorModel) disposeGltf(exteriorModel); 
   exteriorModel = null;
   reticleMesh.visible = false;
    
   // Reset UI
   placementIndicator.classList.add('hidden');
   ui.statusMessage.classList.add('hidden');
   ui.floorSelection.classList.add('hidden');
   ui.startButton.classList.remove('hidden');
    
   renderer.setAnimationLoop(null);
}
 
// 7. Masuk ke Mode VR (Interior)
async function onEnterVR(floorNumber) {
   console.log(`Masuk ke Lantai ${floorNumber}`);
    
   if (xrSession) {
       await xrSession.end();
       // onAREnd akan otomatis ter-trigger dan membersihkan exteriorModel
   }
    
   currentMode = 'VR_INTERIOR';
    
   ui.floorSelection.classList.add('hidden');
   ui.startButton.classList.add('hidden');

   // Tentukan nama file berdasarkan lantai yang dipilih
   let modelFileToLoad = '';
   if (floorNumber == 1) {
       // **GANTI NAMA FILE INI** dengan model lantai 1
       modelFileToLoad = 'interior-lantai-1.glb';
   } else if (floorNumber == 2) {
       // **GANTI NAMA FILE INI** dengan model lantai 2
       modelFileToLoad = 'interior-lantai-2.glb';
   } else {
       console.warn("Nomor lantai tidak valid:", floorNumber);
       onExitVR(); // Kembali ke state awal jika lantai tidak valid
       return;
   }

   // Muat model yang sesuai
   loader.load(modelFileToLoad, (gltf) => {
       interiorModel = gltf.scene;

       // **PENTING: ATUR SKALA MODEL ANDA DI SINI**
       interiorModel.scale.set(1.0, 1.0, 1.0); 

       scene.add(interiorModel);

       // Pindahkan ini ke dalam callback agar UI muncul SETELAH model dimuat
       ui.exitVrButton.classList.remove('hidden');
       renderer.setAnimationLoop(renderVRFrame);

   }, undefined, (error) => {
       console.error(`Gagal memuat ${modelFileToLoad}:`, error);
       onExitVR(); // Gagal load, kembali ke state awal
   });

   // 5. Atur Kamera & Kontrol
   camera.position.set(0, 1.6, 3);
   camera.lookAt(0, 1.6, 0); 
    
   controls = new OrbitControls(camera, renderer.domElement);
   controls.target.set(0, 1.6, 0);
   controls.enableDamping = true;
   controls.dampingFactor = 0.05;
   controls.screenSpacePanning = false;
   controls.minDistance = 0.5;
   controls.maxDistance = 5;
    
   renderer.setClearColor(0x333333);
   renderer.setClearAlpha(1.0);
}

// 8. Keluar dari Mode VR
function onExitVR() {
   currentMode = 'NONE';
    
   renderer.setAnimationLoop(null);
    
   if (controls) {
       controls.dispose();
       controls = null;
   }
    
   // PERBAIKAN: Gunakan disposeGltf
   if (interiorModel) disposeGltf(interiorModel); 
   interiorModel = null;
    
   camera.position.set(0, 0, 0);
   camera.lookAt(0, 0, -1);
    
   renderer.setClearColor(0x000000, 0);
   renderer.setClearAlpha(0.0);
    
   ui.exitVrButton.classList.add('hidden');
   ui.startButton.classList.remove('hidden');
}

// 9. Loop Render VR
function renderVRFrame() {
   if (controls) {
       controls.update();
   }
   renderer.render(scene, camera);
}

// --- Fungsi Gestur (BARU) ---

function onTouchStart(event) {
   if (currentMode !== 'AR_VIEWING' || event.touches.length !== 2 || !exteriorModel) return;
   event.preventDefault();
   initialPinchDistance = getTouchDistance(event.touches);
   initialTwistAngle = getTouchAngle(event.touches);
   baseScale = exteriorModel.scale.x;
   baseRotationY = exteriorModel.rotation.y;
}

function onTouchMove(event) {
   // PERBAIKAN SINTAKSIS: f -> if
   if (currentMode !== 'AR_VIEWING' || event.touches.length !== 2 || !exteriorModel) return;
   event.preventDefault();

   // 1. Zoom (Pinch)
   const currentDistance = getTouchDistance(event.touches);
   const scaleFactor = currentDistance / initialPinchDistance;
   const newScale = baseScale * scaleFactor;
   const clampedScale = Math.max(0.01, Math.min(newScale, 2.0)); // Sesuaikan batas min/max jika perlu
   exteriorModel.scale.set(clampedScale, clampedScale, clampedScale);

   // 2. Rotate (Twist)
   const currentAngle = getTouchAngle(event.touches);
   const angleDelta = currentAngle - initialTwistAngle;
   const newRotationY = baseRotationY + angleDelta;
   exteriorModel.rotation.y = newRotationY;
}

function onTouchEnd(event) {
   initialPinchDistance = 0;
   initialTwistAngle = 0;
}

function getTouchDistance(touches) {
   const dx = touches[0].clientX - touches[1].clientX;
   const dy = touches[0].clientY - touches[1].clientY;
   return Math.sqrt(dx * dx + dy * dy);
}

function getTouchAngle(touches) {
   const dx = touches[0].clientX - touches[1].clientX;
   const dy = touches[0].clientY - touches[1].clientY;
   return Math.atan2(dy, dx);
}

// --- Mulai Aplikasi ---
init();