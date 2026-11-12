/** Every number the engine is tuned by, in one place. Distances are world units, times are seconds. */

/** The simulation advances in fixed steps of this length, whatever the screen does. */
export const DT = 1 / 60;

/** The sheet of paper always has this area; its shape follows the screen. */
export const WORLD_AREA = 800_000;

// ---- track ----
export const HALF_WIDTH = 26;
/** Spacing of the control points a track is stored as. */
export const CTRL_SPACING = 28;
/** Spacing of the centre-line samples a track is driven on. */
export const SAMPLE_SPACING = 6;
export const MIN_LENGTH = 900;
export const MAX_LENGTH = 6400;
/** A drawn corner is opened up until its radius is at least this. */
export const RELAX_RADIUS = 42;
/** Two stretches of road are pushed apart until their centres are this far apart. */
export const RELAX_GAP = 2 * HALF_WIDTH + 30;
/** What a finished track has to satisfy to be accepted. */
export const VALID_RADIUS = 33;
export const VALID_GAP = 2 * HALF_WIDTH + 6;
/** Two points count as "different stretches" when they are this far apart along the road. */
export const GAP_ARC = 150;
/** Paper margin kept free around the road. */
export const MARGIN = HALF_WIDTH + 12;

// ---- car ----
export const CAR_LENGTH = 20;
export const CAR_WIDTH = 10;
export const MAX_SPEED = 300;
export const ENGINE = 300;
export const BRAKE = 560;
export const DRAG = 0.12;
/** Sideways acceleration the tyres can hold before the car slides. */
export const GRIP = 640;
/** Tightest circle the car can turn at walking pace. */
export const TURN_RADIUS = 24;
/** How fast the steering moves from one side to the other (full locks per second). */
export const STEER_RATE = 7;
/** The car may ask for a little more turn than the tyres can give; that is the slide. */
export const OVERSTEER = 1.12;
/** A car whose centre is further than this from the middle of the road has hit the wall. */
export const WALL_REACH = HALF_WIDTH - CAR_WIDTH * 0.4;

// ---- senses ----
export const RAY_ANGLES = [-75, -45, -20, 0, 20, 45, 75].map((d) => (d * Math.PI) / 180);
export const RAY_RANGE = 300;

// ---- network ----
/** Seven distances and the speed in, six hidden neurons, steering and pedal out. */
export const LAYERS: readonly number[] = [RAY_ANGLES.length + 1, 6, 2];

// ---- learning ----
export const POPULATION = 50;
export const TARGET_LAPS = 3;
/** Cars start this far behind the line. */
export const GRID_OFFSET = 26;
/** A car that gains no ground for this long is retired. */
export const STALL_TIME = 1.6;
/** A car this far behind the line is driving the wrong way. */
export const WRONG_WAY = 30;
/** The sweeper: a car must average at least this speed, after a head start. */
export const PACE = 55;
export const PACE_SLACK = 170;
