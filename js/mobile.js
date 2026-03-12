// ============================================================
// MOBILE TOUCH CONTROLS — Virtual joystick + action buttons
// ============================================================

const mobileControls = {
    isMobile: false,
    joystick: { active: false, startX: 0, startY: 0, dx: 0, dy: 0, touchId: null },
    attackPressed: false,
    interactPressed: false,

    init() {
        // Detect mobile via touch capability + screen size
        this.isMobile = ('ontouchstart' in window || navigator.maxTouchPoints > 0)
            && (window.innerWidth <= 1024 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

        if (!this.isMobile) return;

        const controls = document.getElementById('mobile-controls');
        if (controls) controls.style.display = 'block';

        this._setupJoystick();
        this._setupButtons();
    },

    _setupJoystick() {
        const zone = document.getElementById('touch-joystick-zone');
        const base = document.getElementById('touch-joystick-base');
        const thumb = document.getElementById('touch-joystick-thumb');
        if (!zone || !base || !thumb) return;

        const maxDist = 50; // max joystick displacement

        zone.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.changedTouches[0];
            this.joystick.active = true;
            this.joystick.touchId = touch.identifier;
            this.joystick.startX = touch.clientX;
            this.joystick.startY = touch.clientY;
            this.joystick.dx = 0;
            this.joystick.dy = 0;

            // Show joystick at touch position
            base.style.display = 'block';
            base.style.left = (touch.clientX - 60) + 'px';
            base.style.top = (touch.clientY - 60) + 'px';
            thumb.style.display = 'block';
            thumb.style.left = (touch.clientX - 25) + 'px';
            thumb.style.top = (touch.clientY - 25) + 'px';
        }, { passive: false });

        zone.addEventListener('touchmove', (e) => {
            e.preventDefault();
            for (const touch of e.changedTouches) {
                if (touch.identifier !== this.joystick.touchId) continue;
                let dx = touch.clientX - this.joystick.startX;
                let dy = touch.clientY - this.joystick.startY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > maxDist) {
                    dx = dx / dist * maxDist;
                    dy = dy / dist * maxDist;
                }
                this.joystick.dx = dx / maxDist; // -1 to 1
                this.joystick.dy = dy / maxDist;

                thumb.style.left = (this.joystick.startX + dx - 25) + 'px';
                thumb.style.top = (this.joystick.startY + dy - 25) + 'px';
            }
        }, { passive: false });

        const endJoystick = (e) => {
            for (const touch of e.changedTouches) {
                if (touch.identifier !== this.joystick.touchId) continue;
                this.joystick.active = false;
                this.joystick.dx = 0;
                this.joystick.dy = 0;
                this.joystick.touchId = null;
                base.style.display = 'none';
                thumb.style.display = 'none';
            }
        };

        zone.addEventListener('touchend', endJoystick, { passive: false });
        zone.addEventListener('touchcancel', endJoystick, { passive: false });
    },

    _setupButtons() {
        const atkBtn = document.getElementById('touch-attack-btn');
        const intBtn = document.getElementById('touch-interact-btn');

        if (atkBtn) {
            atkBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.attackPressed = true;
            }, { passive: false });
            atkBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.attackPressed = false;
            }, { passive: false });
        }

        if (intBtn) {
            intBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.interactPressed = true;
            }, { passive: false });
            intBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.interactPressed = false;
            }, { passive: false });
        }
    },

    // Get normalized joystick vector (-1 to 1)
    getMovement() {
        if (!this.joystick.active) return { x: 0, y: 0 };
        // Apply dead zone
        const deadZone = 0.15;
        let x = this.joystick.dx;
        let y = this.joystick.dy;
        if (Math.abs(x) < deadZone) x = 0;
        if (Math.abs(y) < deadZone) y = 0;
        return { x, y };
    },

    // Consume attack press (returns true once per press)
    consumeAttack() {
        if (this.attackPressed) {
            this.attackPressed = false;
            return true;
        }
        return false;
    },

    // Consume interact press
    consumeInteract() {
        if (this.interactPressed) {
            this.interactPressed = false;
            return true;
        }
        return false;
    },
};

// Auto-init on load
document.addEventListener('DOMContentLoaded', () => mobileControls.init());
