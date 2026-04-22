import { infiniteSoldiersGame } from "./infinite-soldiers.js";

const root = document.querySelector("[data-infinite-soldiers-root]");

if (root) {
    configureMobileAppShell(root);
    void infiniteSoldiersGame.init(root);
}

function configureMobileAppShell(container) {
    let lastTouchEndAt = 0;

    const preventDefault = (event) => {
        if (event.cancelable) {
            event.preventDefault();
        }
    };

    container.addEventListener("contextmenu", preventDefault);
    container.addEventListener("touchstart", (event) => {
        if (event.touches.length > 1) {
            preventDefault(event);
        }
    }, { passive: false });
    container.addEventListener("touchend", (event) => {
        const now = performance.now();

        if (now - lastTouchEndAt < 300) {
            preventDefault(event);
        }

        lastTouchEndAt = now;
    }, { passive: false });
    document.addEventListener("dblclick", preventDefault);
    document.addEventListener("gesturestart", preventDefault);
}
