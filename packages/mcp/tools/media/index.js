import { register as registerImage } from "./image.js";
import { register as registerVideo } from "./video.js";

export function register(server) {
  registerImage(server);
  registerVideo(server);
}