navigator.getGamepads = () => [];
Object.defineProperty(Document.prototype,'pointerLockElement',{get(){return window.__plock? document.getElementById('gl'):null}});
HTMLCanvasElement.prototype.requestPointerLock = function(){ window.__plock = true; return Promise.resolve(); };
Document.prototype.exitPointerLock = function(){ window.__plock = false; };
