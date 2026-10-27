import { clamp } from "./math";

export interface DriveInput {
  /** +1 full ahead, -1 full reverse, relative to the hull's facing. */
  forward: number;
  /** +1 rotate clockwise (right), -1 rotate counter-clockwise (left). */
  turn: number;
}

export interface InputController {
  getDrive(): DriveInput;
  /** Aim stick in screen space. Angle 0 points up the screen; positive is clockwise. */
  getAimStick(): { active: boolean; angle: number };
  isFiringFromPointer(): boolean;
  getMouseClient(): { x: number; y: number; valid: boolean };
  destroy(): void;
}

interface StickState {
  x: number;
  yUp: number;
  active: boolean;
}

/**
 * Left stick: Y drives forward/back along the hull, X turns the hull.
 * Right stick: direction is world/screen aim, and holding it off-center fires.
 * WASD (and arrows) mirror the left stick. Mouse/pen aim is read separately.
 */
export function attachInput(
  moveBase: HTMLElement,
  moveKnob: HTMLElement,
  aimBase: HTMLElement,
  aimKnob: HTMLElement,
): InputController {
  const move: StickState = { x: 0, yUp: 0, active: false };
  const aim: StickState = { x: 0, yUp: 0, active: false };
  const keys = new Set<string>();
  let mouseDown = false;
  let mouseX = 0;
  let mouseY = 0;
  let mouseValid = false;

  const stops: Array<() => void> = [];

  stops.push(bindStick(moveBase, moveKnob, move));
  stops.push(bindStick(aimBase, aimKnob, aim));

  const onKeyDown = (event: KeyboardEvent): void => {
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (event.code === "Space" && (tag === "BUTTON" || tag === "A")) return;
    if (event.code.startsWith("Arrow") || event.code === "Space") event.preventDefault();
    keys.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    keys.delete(event.code);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "touch") return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".joystick, button, a")) return;
    mouseDown = true;
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === "touch") return;
    if (event.button !== 0) return;
    mouseDown = false;
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch") return;
    mouseX = event.clientX;
    mouseY = event.clientY;
    mouseValid = true;
  };
  const onBlur = (): void => {
    keys.clear();
    mouseDown = false;
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("blur", onBlur);

  return {
    getDrive(): DriveInput {
      let forward = move.yUp;
      let turn = move.x;
      if (keys.has("KeyW") || keys.has("ArrowUp")) forward += 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) forward -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) turn += 1;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) turn -= 1;
      return { forward: clamp(forward, -1, 1), turn: clamp(turn, -1, 1) };
    },
    getAimStick(): { active: boolean; angle: number } {
      if (!aim.active) return { active: false, angle: 0 };
      return { active: true, angle: Math.atan2(aim.x, aim.yUp) };
    },
    isFiringFromPointer(): boolean {
      return mouseDown || keys.has("Space");
    },
    getMouseClient(): { x: number; y: number; valid: boolean } {
      return { x: mouseX, y: mouseY, valid: mouseValid };
    },
    destroy(): void {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", onBlur);
      for (const stop of stops) stop();
      keys.clear();
    },
  };
}

function bindStick(base: HTMLElement, knob: HTMLElement, state: StickState): () => void {
  let pointerId: number | null = null;

  const apply = (clientX: number, clientY: number): void => {
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const travel = rect.width * 0.36;
    const mag = Math.hypot(dx, dy);
    if (mag > travel && mag > 0) {
      dx = (dx / mag) * travel;
      dy = (dy / mag) * travel;
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const nx = travel > 0 ? dx / travel : 0;
    const nyUp = travel > 0 ? -dy / travel : 0;
    const shaped = shapeStick(nx, nyUp);
    state.x = shaped.x;
    state.yUp = shaped.yUp;
    state.active = shaped.active;
  };

  const end = (): void => {
    pointerId = null;
    knob.style.transform = "translate(-50%, -50%)";
    state.x = 0;
    state.yUp = 0;
    state.active = false;
  };

  const onDown = (event: PointerEvent): void => {
    pointerId = event.pointerId;
    base.setPointerCapture(event.pointerId);
    apply(event.clientX, event.clientY);
    event.preventDefault();
  };
  const onMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    apply(event.clientX, event.clientY);
    event.preventDefault();
  };
  const onUp = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    end();
  };

  base.addEventListener("pointerdown", onDown);
  base.addEventListener("pointermove", onMove);
  base.addEventListener("pointerup", onUp);
  base.addEventListener("pointercancel", onUp);

  return () => {
    base.removeEventListener("pointerdown", onDown);
    base.removeEventListener("pointermove", onMove);
    base.removeEventListener("pointerup", onUp);
    base.removeEventListener("pointercancel", onUp);
    end();
  };
}

/** Deadzone, then rescale so the edge of the stick is full deflection. */
function shapeStick(x: number, yUp: number): StickState {
  const dead = 0.16;
  const mag = Math.hypot(x, yUp);
  if (mag < dead) return { x: 0, yUp: 0, active: false };
  const scaled = clamp((mag - dead) / (1 - dead), 0, 1);
  return { x: (x / mag) * scaled, yUp: (yUp / mag) * scaled, active: true };
}
