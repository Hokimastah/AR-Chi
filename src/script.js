import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

class ARObjectPlacement {
    constructor() {
        this.canvas = null;
        this.gl = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.session = null;
        this.referenceSpace = null;
        this.viewerSpace = null;
        this.hitTestSource = null;

        this.reticle = null;
        this.arObject = null;
        this.availableModels = [];
        this.currentModelIndex = 0;
        this.placedObjects = [];
        this.selectedObject = null;
        this.objectIndex = 0;
        this.isInteractingWithUI = false;
        this.lastUIInteraction = 0;
        
        // For object selection
        this.raycaster = new THREE.Raycaster();
        this.highlightBox = null;

        // FPV Mode
        this.fpvMode = false;
        this.fpvObject = null;
        this.fpvOriginalScale = new THREE.Vector3();
        this.fpvOriginalPosition = new THREE.Vector3();
        this.fpvOriginalRotation = new THREE.Euler();
        this.fpvTargetScale = 20; // Multiplier untuk scale 1:1
        this.baseMovementSpeed = 0.05; // Base speed disesuaikan untuk skala AR
        this.movementSpeedMultiplier = 1;
        
        // FPV Collision Detection Properties
        this.playerHeight = 1.7; // Approx user height in meters
        this.playerRadius = 0.3; // Approx user radius
        this.collisionRaycaster = new THREE.Raycaster(); // Dedicated raycaster for FPV collisions

        // Movement state
        this.movementState = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            up: false,
            down: false
        };
        
        this.init();
    }
    
    async init() {
        await this.checkWebXRSupport();
        this.setupEventListeners();
        await this.loadModels();
        this.createSelectionHighlight();
    }

    createSelectionHighlight() {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const edges = new THREE.EdgesGeometry(geometry);
        const material = new THREE.LineBasicMaterial({ 
            color: 0x00ff00, 
            linewidth: 2,
            transparent: true,
            opacity: 0.8
        });
        this.highlightBox = new THREE.LineSegments(edges, material);
        this.highlightBox.visible = false;
    }
    
    async checkWebXRSupport() {
        const statusEl = document.getElementById('status');
        const startButton = document.getElementById('startButton');
        
        if (!navigator.xr) {
            statusEl.innerHTML = 'WebXR tidak tersedia. Buka di Chrome Android.';
            startButton.textContent = 'WebXR Tidak Tersedia';
            return;
        }
        
        try {
            const supported = await navigator.xr.isSessionSupported('immersive-ar');
            if (supported) {
                statusEl.innerHTML = 'WebXR AR didukung! Memuat model...';
                startButton.disabled = false;
            } else {
                statusEl.innerHTML = 'WebXR AR tidak didukung di perangkat ini';
                startButton.textContent = 'AR Tidak Didukung';
            }
        } catch (error) {
            console.error('Error checking WebXR support:', error);
            statusEl.innerHTML = 'Error memeriksa dukungan WebXR';
            startButton.textContent = 'Error';
        }
    }
    
    async loadModels() {
        const statusEl = document.getElementById('status');
        const startButton = document.getElementById('startButton');

        try {
            const loader = new GLTFLoader();

            this.reticle = null;
            let reticleLoaded = false;
            
            // Fallback reticle logic
            try {
                // Gunakan ring geometry sederhana agar lebih ringan dan pasti load
                const ringGeometry = new THREE.RingGeometry(0.1, 0.11, 32).rotateX(-Math.PI / 2);
                const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
                this.reticle = new THREE.Mesh(ringGeometry, ringMaterial);
                
                // Opsional: Load reticle GLTF eksternal jika diinginkan
                // const reticleGltf = await this.loadGLTF(loader, 'https://immersive-web.github.io/webxr-samples/media/gltf/reticle/reticle.gltf');
                // this.reticle = reticleGltf.scene;
                
                reticleLoaded = true;
                console.log('Reticle created');
            } catch (reticleError) {
                console.warn('Failed to create reticle:', reticleError);
            }

            if (!this.reticle) throw new Error('Failed to load reticle');
            this.reticle.visible = false;
            this.reticle.matrixAutoUpdate = false;

            // Define available models (GLB)
            // UPDATE: Menghapus 'public/' karena Vite serve root dari folder public
            this.availableModels = [
                { name: 'Tower House', url: '/tower_house_design.glb' },
                { name: 'Kitchen', url: '/interior-fix2.glb' },
                { name: 'Astronaut', url: '/Astronaut.glb' },
                { name: '3 Bedroom House', url: '/3_bedroom_house.glb' }
            ];

            // Load the first model
            await this.loadSpecificModel(loader, this.availableModels[0].url);
            
            statusEl.innerHTML = 'Model berhasil dimuat! Siap memulai AR';
            startButton.textContent = 'Mulai AR';
            startButton.disabled = false;

        } catch (error) {
            console.error('Error loading models:', error);
            statusEl.innerHTML = 'Gagal memuat model: ' + error.message;
        }
    }

    async loadSpecificModel(loader, modelUrl) {
        try {
            const objectGltf = await this.loadGLTF(loader, modelUrl);
            this.arObject = objectGltf.scene;

            this.arObject.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            this.deselectObject();

        } catch (error) {
            console.error(`Error loading model ${modelUrl}:`, error);
            throw error;
        }
    }

    // --- LOGIKA UPLOAD FBX ---
    handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const url = URL.createObjectURL(file);
        const statusEl = document.getElementById('status');

        statusEl.innerHTML = 'Memuat file FBX...';
        
        const loader = new FBXLoader();
        
        loader.load(url, (object) => {
            // Skala awal FBX seringkali besar (cm), ubah ke meter (0.01)
            object.scale.set(0.01, 0.01, 0.01); 

            object.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    if (child.material) {
                        child.material.side = THREE.DoubleSide; 
                    }
                }
            });

            this.arObject = object;
            this.deselectObject();
            
            console.log('FBX Loaded from file');
            statusEl.innerHTML = 'File FBX siap! Ketuk layar untuk menempatkan.';
            
            const modelSelect = document.getElementById('modelSelect');
            let customOption = modelSelect.querySelector('option[value="custom_upload"]');
            if (!customOption) {
                customOption = document.createElement('option');
                customOption.value = "custom_upload";
                modelSelect.add(customOption);
            }
            customOption.text = `(Uploaded) ${file.name}`;
            modelSelect.value = "custom_upload";

        }, (xhr) => {
            console.log((xhr.loaded / xhr.total * 100) + '% loaded');
        }, (error) => {
            console.error('Error loading FBX:', error);
            statusEl.innerHTML = 'Gagal memuat FBX. Pastikan format valid.';
        });
    }
    
    loadGLTF(loader, url) {
        return new Promise((resolve, reject) => {
            loader.load(url, resolve, undefined, reject);
        });
    }
    
    setupEventListeners() {
        const startButton = document.getElementById('startButton');
        const resetButton = document.getElementById('resetButton');
        const exitButton = document.getElementById('exitButton');
        const deleteButton = document.getElementById('deleteButton');
        const deselectButton = document.getElementById('deselectButton');
        const fpvButton = document.getElementById('fpvButton');
        const scaleSlider = document.getElementById('scaleSlider');
        const rotateSlider = document.getElementById('rotateSlider');
        const modelSelect = document.getElementById('modelSelect');
        const controlsContainer = document.getElementById('controls');
        
        const fileUpload = document.getElementById('fileUpload');
        if (fileUpload) {
            fileUpload.addEventListener('change', (e) => this.handleFileUpload(e));
        }

        startButton.addEventListener('click', () => this.startAR());

        modelSelect.addEventListener('change', (e) => {
            if (e.target.value === "custom_upload") return; 

            const selectedModel = this.availableModels.find(model => model.url === e.target.value);
            if (selectedModel && this.arObject) {
                this.loadSpecificModel(new GLTFLoader(), selectedModel.url)
                    .then(() => console.log(`Switched to model: ${selectedModel.name}`))
                    .catch(error => {
                        console.error('Failed to load selected model:', error);
                        alert('Gagal memuat model yang dipilih');
                    });
            }
        });
        
        // Helper untuk mencegah klik tembus ke canvas saat interaksi UI
        const preventCanvasClick = (e) => {
            this.isInteractingWithUI = true;
            this.lastUIInteraction = Date.now();
            e.stopPropagation();
        };
        const resetCanvasClick = () => {
            this.lastUIInteraction = Date.now();
            setTimeout(() => { this.isInteractingWithUI = false; }, 500);
        };

        // Terapkan ke container kontrol
        [controlsContainer].forEach(el => {
            if(el) {
                el.addEventListener('touchstart', preventCanvasClick);
                el.addEventListener('touchend', resetCanvasClick);
                el.addEventListener('click', preventCanvasClick);
            }
        });
        
        resetButton.addEventListener('click', () => { this.resetObjects(); resetCanvasClick(); });
        exitButton.addEventListener('click', () => { this.exitAR(); resetCanvasClick(); });
        deleteButton.addEventListener('click', () => { this.deleteSelectedObject(); resetCanvasClick(); });
        deselectButton.addEventListener('click', () => { this.deselectObject(); resetCanvasClick(); });
        fpvButton.addEventListener('click', () => { this.enterFPVMode(); resetCanvasClick(); });

        this.setupSliderEvents(scaleSlider, 'scale');
        this.setupSliderEvents(rotateSlider, 'rotate');

        this.setupFPVControls();
    }

    setupSliderEvents(slider, type) {
        if(!slider) return;
        
        const start = () => {
            this.isInteractingWithUI = true;
            this.lastUIInteraction = Date.now();
        };
        const end = () => {
            this.lastUIInteraction = Date.now();
            setTimeout(() => { this.isInteractingWithUI = false; }, 500);
        };

        slider.addEventListener('touchstart', start);
        slider.addEventListener('touchend', end);
        slider.addEventListener('mousedown', start);
        slider.addEventListener('mouseup', end);
        
        if (type === 'scale') {
            slider.addEventListener('input', (e) => this.onScaleChange(e.target.value));
        } else if (type === 'rotate') {
            slider.addEventListener('input', (e) => this.onRotateChange(e.target.value));
        }
    }

    setupFPVControls() {
        const fpvControlsContainer = document.getElementById('fpvControls');
        const fpvExitButton = document.getElementById('fpvExitButton');
        const speedSlider = document.getElementById('speedSlider');
        
        if (fpvControlsContainer) {
            fpvControlsContainer.addEventListener('touchstart', (e) => {
                this.isInteractingWithUI = true;
                this.lastUIInteraction = Date.now();
                e.stopPropagation();
            });
            fpvControlsContainer.addEventListener('touchend', () => {
                this.lastUIInteraction = Date.now();
                setTimeout(() => { this.isInteractingWithUI = false; }, 500);
            });
        }

        this.setupMovementButton('forwardButton', 'forward');
        this.setupMovementButton('backwardButton', 'backward');
        this.setupMovementButton('leftButton', 'left');
        this.setupMovementButton('rightButton', 'right');
        this.setupMovementButton('moveUpButton', 'up');
        this.setupMovementButton('moveDownButton', 'down');

        if (speedSlider) {
            speedSlider.addEventListener('input', (e) => {
                this.movementSpeedMultiplier = parseFloat(e.target.value);
                const valEl = document.getElementById('speedValue');
                if(valEl) valEl.textContent = this.movementSpeedMultiplier + 'x';
            });
        }

        if (fpvExitButton) {
            fpvExitButton.addEventListener('click', () => {
                this.exitFPVMode();
                this.lastUIInteraction = Date.now();
            });
        }
    }

    setupMovementButton(buttonId, direction) {
        const button = document.getElementById(buttonId);
        if (!button) return;
        
        const startMove = (e) => {
            if(e.cancelable) e.preventDefault();
            this.movementState[direction] = true;
            this.lastUIInteraction = Date.now();
        };
        
        const endMove = (e) => {
            if(e.cancelable) e.preventDefault();
            this.movementState[direction] = false;
            this.lastUIInteraction = Date.now();
        };

        button.addEventListener('touchstart', startMove, {passive: false});
        button.addEventListener('touchend', endMove);
        button.addEventListener('mousedown', startMove);
        button.addEventListener('mouseup', endMove);
        button.addEventListener('mouseleave', endMove);
    }
    
    async startAR() {
        try {
            this.canvas = document.createElement("canvas");
            document.body.appendChild(this.canvas);
            
            this.gl = this.canvas.getContext("webgl", {
                xrCompatible: true,
                alpha: true,
                antialias: true
            });
            
            if (!this.gl) throw new Error("WebGL not supported");
            
            this.scene = new THREE.Scene();
            
            const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
            directionalLight.position.set(10, 15, 10);
            this.scene.add(directionalLight);
            
            const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
            directionalLight2.position.set(-10, 10, -10);
            this.scene.add(directionalLight2);
            
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
            this.scene.add(ambientLight);
            
            // Hemisphere light for better outdoor feel
            const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
            hemiLight.position.set(0, 20, 0);
            this.scene.add(hemiLight);
            
            this.scene.add(this.reticle);
            this.scene.add(this.highlightBox);
            
            this.renderer = new THREE.WebGLRenderer({
                alpha: true,
                preserveDrawingBuffer: true,
                canvas: this.canvas,
                context: this.gl,
                antialias: true
            });
            this.renderer.autoClear = false;
            
            // UPDATE: Modern Color Space
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.0;
            
            this.camera = new THREE.PerspectiveCamera();
            this.camera.matrixAutoUpdate = false;
            
            this.session = await navigator.xr.requestSession("immersive-ar", {
                requiredFeatures: ['hit-test'],
                optionalFeatures: ['dom-overlay'],
                domOverlay: { root: document.getElementById('container') }
            });
            
            this.session.updateRenderState({
                baseLayer: new XRWebGLLayer(this.session, this.gl)
            });
            
            this.referenceSpace = await this.session.requestReferenceSpace('local');
            this.viewerSpace = await this.session.requestReferenceSpace('viewer');
            
            this.hitTestSource = await this.session.requestHitTestSource({
                space: this.viewerSpace
            });
            
            this.session.addEventListener('end', () => this.onSessionEnded());
            this.session.addEventListener('select', (event) => this.onSelect(event));
            
            this.session.requestAnimationFrame((time, frame) => this.onXRFrame(time, frame));
            
            document.getElementById('ui').style.display = 'none';
            document.getElementById('instructions').style.display = 'block';
            document.getElementById('controls').style.display = 'flex';
            document.getElementById('exitButton').style.display = 'block';
            
            console.log('AR session started successfully');
            
        } catch (error) {
            console.error('Error starting AR:', error);
            alert('Gagal memulai AR: ' + error.message);
            this.cleanup();
        }
    }
    
    onXRFrame(time, frame) {
        this.session.requestAnimationFrame((time, frame) => this.onXRFrame(time, frame));
        
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.session.renderState.baseLayer.framebuffer);
        
        const pose = frame.getViewerPose(this.referenceSpace);
        
        if (pose) {
            this.renderer.clear();
            
            if (!this.fpvMode) {
                this.handleHitTest(frame);
            } else {
                this.handleFPVMovement(pose);
            }
            
            for (const view of pose.views) {
                const viewport = this.session.renderState.baseLayer.getViewport(view);
                this.renderer.setSize(viewport.width, viewport.height);
                
                this.camera.matrix.fromArray(view.transform.matrix);
                this.camera.projectionMatrix.fromArray(view.projectionMatrix);
                this.camera.updateMatrixWorld(true);
                
                this.renderer.render(this.scene, this.camera);
            }
        }
    }

    handleFPVMovement(pose) {
        if (!this.fpvObject) return;

        const moveSpeed = this.baseMovementSpeed * this.movementSpeedMultiplier;
        
        // Get camera's current position and orientation
        const view = pose.views[0];
        const cameraMatrix = new THREE.Matrix4().fromArray(view.transform.matrix);
        
        // Extract forward and right vectors from camera
        const forward = new THREE.Vector3(0, 0, -1);
        const right = new THREE.Vector3(1, 0, 0);
        
        forward.applyMatrix4(cameraMatrix);
        right.applyMatrix4(cameraMatrix);
        
        // Project to horizontal plane (remove Y component)
        forward.y = 0;
        forward.normalize();
        right.y = 0;
        right.normalize();

        // Calculate desired movement offset
        const desiredMovement = new THREE.Vector3();
        
        // INVERSE movement: when user "moves forward", world moves backward
        if (this.movementState.forward) {
            desiredMovement.sub(forward.multiplyScalar(moveSpeed));
        }
        if (this.movementState.backward) {
            desiredMovement.add(forward.multiplyScalar(moveSpeed));
        }
        if (this.movementState.left) {
            desiredMovement.add(right.multiplyScalar(moveSpeed));
        }
        if (this.movementState.right) {
            desiredMovement.sub(right.multiplyScalar(moveSpeed));
        }
        if (this.movementState.up) {
            desiredMovement.y -= moveSpeed; // Move world down = user goes up
        }
        if (this.movementState.down) {
            desiredMovement.y += moveSpeed; // Move world up = user goes down
        }

        // --- INTEGRATE COLLISION CHECK HERE ---
        const adjustedMovement = this.checkFPVCollisions(desiredMovement);

        // Apply adjusted movement to the FPV object
        this.fpvObject.position.add(adjustedMovement);
    }
    
    handleHitTest(frame) {
        if (!this.hitTestSource || !this.reticle) return;

        const hitTestResults = frame.getHitTestResults(this.hitTestSource);

        if (hitTestResults.length > 0) {
            const hitPose = hitTestResults[0].getPose(this.referenceSpace);

            if (hitPose) {
                this.reticle.visible = true;
                // UPDATE: Menggunakan matriks langsung untuk posisi & rotasi yang lebih akurat
                this.reticle.matrix.fromArray(hitPose.transform.matrix);
            } else {
                this.reticle.visible = false;
            }
        } else {
            this.reticle.visible = false;
        }
    }
    
    onSelect(event) {
        const timeSinceLastUI = Date.now() - this.lastUIInteraction;
        
        if (this.isInteractingWithUI || timeSinceLastUI < 500) return;
        if (this.fpvMode) return;

        const frame = event.frame;
        const inputSource = event.inputSource;
        
        // Raycast logic untuk select object
        if (inputSource && frame) {
            const pose = frame.getPose(inputSource.targetRaySpace, this.referenceSpace);
            
            if (pose) {
                const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
                const origin = new THREE.Vector3().setFromMatrixPosition(matrix);
                const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(matrix));
                
                this.raycaster.set(origin, direction.normalize());
                
                const intersects = this.raycaster.intersectObjects(this.placedObjects, true);
                
                if (intersects.length > 0) {
                    let selectedObj = intersects[0].object;
                    // Traverse ke atas sampai ketemu root object yang kita place
                    while (selectedObj.parent && !this.placedObjects.includes(selectedObj)) {
                        selectedObj = selectedObj.parent;
                    }
                    
                    if (this.placedObjects.includes(selectedObj)) {
                        this.selectObject(selectedObj);
                        console.log('Object selected via raycast');
                        return;
                    }
                }
            }
        }
        
        // Logic place object
        if (this.reticle.visible && this.arObject) {
            this.placeObject();
        }
    }

    placeObject() {
        const clone = this.arObject.clone();
        
        const box = new THREE.Box3().setFromObject(clone);
        const center = new THREE.Vector3();
        box.getCenter(center);
        
        // Posisikan berdasarkan reticle matrix
        clone.position.setFromMatrixPosition(this.reticle.matrix);
        
        // Rotasi sesuai reticle
        clone.rotation.setFromRotationMatrix(this.reticle.matrix);
        
        // Skala
        clone.scale.copy(this.arObject.scale);
        
        clone.userData.objectId = this.objectIndex++;
        
        this.scene.add(clone);
        this.placedObjects.push(clone);
        
        this.selectObject(clone);
        
        console.log('Object placed');
    }

    selectObject(object) {
        this.selectedObject = object;
        this.updateHighlightBox();
        const el = document.getElementById('controls-manipulation');
        if(el) el.style.display = 'flex';

        document.getElementById('selectedObjectId').textContent = '#' + this.selectedObject.userData.objectId;
        document.getElementById('scaleSlider').value = this.selectedObject.scale.x;
        // Konversi radian ke derajat untuk UI
        document.getElementById('rotateSlider').value = (this.selectedObject.rotation.y * 180 / Math.PI) % 360;
    }

    updateHighlightBox() {
        if (!this.selectedObject || !this.highlightBox) return;

        const box = new THREE.Box3().setFromObject(this.selectedObject);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        
        box.getSize(size);
        box.getCenter(center);

        this.highlightBox.scale.copy(size);
        this.highlightBox.position.copy(center);
        this.highlightBox.visible = true;
    }

    deselectObject() {
        this.selectedObject = null;
        if(this.highlightBox) this.highlightBox.visible = false;
        
        const manipulationControls = document.getElementById('controls-manipulation');
        if(manipulationControls) manipulationControls.style.display = 'none';
    }

    deleteSelectedObject() {
        if (!this.selectedObject) return;

        this.scene.remove(this.selectedObject);
        
        const index = this.placedObjects.indexOf(this.selectedObject);
        if (index > -1) {
            this.placedObjects.splice(index, 1);
        }
        
        this.deselectObject();
    }

    enterFPVMode() {
        if (!this.selectedObject) {
            console.log('No object selected for FPV mode');
            return;
        }

        console.log('Entering FPV mode');
        this.fpvMode = true;
        this.fpvObject = this.selectedObject;

        // Save original state
        this.fpvOriginalScale.copy(this.fpvObject.scale);
        this.fpvOriginalPosition.copy(this.fpvObject.position);
        this.fpvOriginalRotation.copy(this.fpvObject.rotation);

        // Scale up to approximate 1:1
        const targetScale = this.fpvOriginalScale.x * this.fpvTargetScale;
        this.fpvObject.scale.set(targetScale, targetScale, targetScale);

        // Hide all other placed objects
        this.placedObjects.forEach(obj => {
            if (obj !== this.fpvObject) {
                obj.visible = false;
            }
        });

        // Hide AR UI and show FPV controls
        this.reticle.visible = false;
        if(this.highlightBox) this.highlightBox.visible = false;
        document.getElementById('controls').style.display = 'none';
        document.getElementById('instructions').style.display = 'none';
        document.getElementById('fpvControls').style.display = 'flex';
    }

    exitFPVMode() {
        if (!this.fpvMode) return;

        console.log('Exiting FPV mode');
        this.fpvMode = false;

        // Restore original state
        if (this.fpvObject) {
            this.fpvObject.scale.copy(this.fpvOriginalScale);
            this.fpvObject.position.copy(this.fpvOriginalPosition);
            this.fpvObject.rotation.copy(this.fpvOriginalRotation);
        }

        // Restore visibility of all other placed objects
        this.placedObjects.forEach(obj => {
            if (obj !== this.fpvObject) {
                obj.visible = true;
            }
        });

        // Reset movement state
        Object.keys(this.movementState).forEach(key => {
            this.movementState[key] = false;
        });

        // Show AR UI and hide FPV controls
        document.getElementById('controls').style.display = 'flex';
        document.getElementById('instructions').style.display = 'block';
        document.getElementById('fpvControls').style.display = 'none';

        this.fpvObject = null;
    }
    
    // --- FULL COLLISION LOGIC ---
    checkFPVCollisions(movementVector) {
        const finalMovement = movementVector.clone();
        if (!this.fpvObject || finalMovement.lengthSq() === 0) {
            return finalMovement;
        }

        const collisionObjects = [];
        this.placedObjects.forEach(obj => {
            obj.traverse(child => {
                if (child.isMesh) {
                    collisionObjects.push(child);
                }
            });
        });

        if (collisionObjects.length === 0) return finalMovement;

        // Player position (camera) at world origin
        const playerPos = new THREE.Vector3(0, 0, 0);
        // Parameter tabrakan
        const playerRadius = this.playerRadius; 
        const playerHeight = this.playerHeight;

        let adjustedMovement = finalMovement.clone();

        // Invert the movement vector for collision checks, as fpvObject moves inversely to camera
        const invertedMovement = finalMovement.clone().negate();

        // Check horizontal collisions (x, z plane)
        const horizontalMovementAttempt = new THREE.Vector3(invertedMovement.x, 0, invertedMovement.z);
        if (horizontalMovementAttempt.lengthSq() > 0) {
            const horizontalDirection = horizontalMovementAttempt.clone().normalize();

            const rays = [
                horizontalDirection,
                horizontalDirection.clone().applyAxisAngle(new THREE.Vector3(0,1,0), Math.PI / 4), // 45 degrees left
                horizontalDirection.clone().applyAxisAngle(new THREE.Vector3(0,1,0), -Math.PI / 4) // 45 degrees right
            ];

            let collisionDetected = false;
            for (const ray of rays) {
                this.collisionRaycaster.set(playerPos, ray);
                this.collisionRaycaster.near = 0;
                this.collisionRaycaster.far = playerRadius + horizontalMovementAttempt.length(); 

                const intersects = this.collisionRaycaster.intersectObjects(collisionObjects, true);

                if (intersects.length > 0) {
                    const firstHit = intersects[0];
                    if (firstHit.distance < playerRadius) { 
                        collisionDetected = true;
                        break;
                    }
                    if (firstHit.distance < horizontalMovementAttempt.length() + playerRadius) {
                        const hitNormal = firstHit.face.normal;
                        hitNormal.y = 0; 
                        hitNormal.normalize();

                        const slideDirection = horizontalMovementAttempt.clone().projectOnPlane(hitNormal);
                        if (slideDirection.lengthSq() > 0) {
                            const invertedSlide = slideDirection.negate();
                            adjustedMovement.x = invertedSlide.x;
                            adjustedMovement.z = invertedSlide.z;
                        } else {
                            adjustedMovement.x = 0;
                            adjustedMovement.z = 0;
                        }
                        collisionDetected = true;
                        break; 
                    }
                }
            }

            if (collisionDetected && adjustedMovement.lengthSq() === 0) {
                finalMovement.x = 0;
                finalMovement.z = 0;
            } else if (collisionDetected) {
                finalMovement.x = adjustedMovement.x;
                finalMovement.z = adjustedMovement.z;
            }
        }

        // Check vertical collisions (y axis) for player head and feet
        const verticalMovementAttempt = invertedMovement.y;
        if (Math.abs(verticalMovementAttempt) > 0) {
            const headPos = playerPos.clone().add(new THREE.Vector3(0, playerHeight / 2 - playerRadius / 2, 0)); 
            const feetPos = playerPos.clone().add(new THREE.Vector3(0, -playerHeight / 2 + playerRadius / 2, 0)); 

            if (verticalMovementAttempt > 0) { 
                this.collisionRaycaster.set(headPos, new THREE.Vector3(0, 1, 0)); 
                this.collisionRaycaster.near = 0;
                this.collisionRaycaster.far = verticalMovementAttempt + playerRadius;

                const ceilingIntersects = this.collisionRaycaster.intersectObjects(collisionObjects, true);
                if (ceilingIntersects.length > 0 && ceilingIntersects[0].distance < verticalMovementAttempt + playerRadius / 2) {
                    finalMovement.y = 0; 
                }
            }
            else if (verticalMovementAttempt < 0) { 
                this.collisionRaycaster.set(feetPos, new THREE.Vector3(0, -1, 0)); 
                this.collisionRaycaster.near = 0;
                this.collisionRaycaster.far = Math.abs(verticalMovementAttempt) + playerRadius;

                const groundIntersects = this.collisionRaycaster.intersectObjects(collisionObjects, true);
                if (groundIntersects.length > 0 && groundIntersects[0].distance < Math.abs(verticalMovementAttempt) + playerRadius / 2) {
                    finalMovement.y = 0; 
                }
            }
        }
        
        const newPlayerPosAttempt = playerPos.clone().add(invertedMovement.clone().multiplyScalar(1)); 

        this.collisionRaycaster.set(playerPos, newPlayerPosAttempt.clone().sub(playerPos).normalize());
        this.collisionRaycaster.near = 0;
        this.collisionRaycaster.far = invertedMovement.length() + playerRadius; 

        const finalPenetrationCheck = this.collisionRaycaster.intersectObjects(collisionObjects, true);
        if (finalPenetrationCheck.length > 0 && finalPenetrationCheck[0].distance < invertedMovement.length()) {
            const hitDistance = finalPenetrationCheck[0].distance;
            const remainingMovementRatio = Math.max(0, (hitDistance - playerRadius / 2) / invertedMovement.length()); 
            finalMovement.multiplyScalar(remainingMovementRatio);
            
            if (remainingMovementRatio < 0.1) {
                finalMovement.set(0,0,0);
            }
        }

        return finalMovement;
    }

    onScaleChange(value) {
        if (this.selectedObject && !this.fpvMode) {
            const scale = parseFloat(value);
            this.selectedObject.scale.set(scale, scale, scale);
            this.updateHighlightBox();
        }
    }

    onRotateChange(value) {
        if (this.selectedObject && !this.fpvMode) {
            const rotationY = parseFloat(value) * Math.PI / 180;
            this.selectedObject.rotation.y = rotationY;
            this.updateHighlightBox();
        }
    }

    resetObjects() {
        if (this.fpvMode) {
            this.exitFPVMode();
        }

        this.placedObjects.forEach(object => {
            this.scene.remove(object);
        });
        this.placedObjects = [];
        this.deselectObject();
        this.objectIndex = 0;
        console.log('All objects removed');
    }
    
    async exitAR() {
        if (this.session) {
            await this.session.end();
        }
    }
    
    onSessionEnded() {
        this.cleanup();
        
        document.getElementById('ui').style.display = 'block';
        document.getElementById('instructions').style.display = 'none';
        document.getElementById('controls').style.display = 'none';
        document.getElementById('fpvControls').style.display = 'none';
        document.getElementById('exitButton').style.display = 'none';
        
        console.log('AR session ended');
    }
    
    cleanup() {
        if (this.hitTestSource) {
            this.hitTestSource.cancel();
            this.hitTestSource = null;
        }
        
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
            this.canvas = null;
        }
        
        this.session = null;
        this.gl = null;
        this.renderer = null;
        this.referenceSpace = null;
        this.viewerSpace = null;
        this.fpvMode = false;
        this.fpvObject = null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ARObjectPlacement();
});