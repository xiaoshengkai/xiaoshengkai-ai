import { register as registerImage } from "./image.js";
import { register as registerMusic } from "./music.js";

export function register(server) {
  registerImage(server);
  registerMusic(server);
}