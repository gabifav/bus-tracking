import { Game } from './core/Game';

const game = new Game(document.body);
game.start();
// Exposed for debugging in the browser console.
(window as unknown as { game: Game }).game = game;
