import { infiniteSoldiersGame } from "./infinite-soldiers.js";

const root = document.querySelector("[data-infinite-soldiers-root]");

if (root) {
    void infiniteSoldiersGame.init(root);
}
