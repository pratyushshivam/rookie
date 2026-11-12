/**
 * The brain: a small feed-forward network. Every neuron adds up its inputs,
 * each multiplied by a weight, adds its own bias, and squashes the total into
 * -1 .. 1 with tanh. That is all of it.
 *
 * Weights are one flat Float32Array so a whole driver is a short list of
 * numbers that can be copied, mixed, nudged and put in a link. For each layer,
 * for each neuron: its incoming weights, then its bias.
 */

export function weightCount(layers: readonly number[]): number {
  let n = 0;
  for (let l = 1; l < layers.length; l++) n += (layers[l - 1] + 1) * layers[l];
  return n;
}

/** One array per layer to hold what each neuron is doing; the brain view reads these. */
export function makeActivations(layers: readonly number[]): Float32Array[] {
  return layers.map((size) => new Float32Array(size));
}

/**
 * Runs the network. `act[0]` must already hold the inputs; the other layers
 * are filled in. Returns the output layer.
 */
export function forward(layers: readonly number[], weights: Float32Array, act: Float32Array[]): Float32Array {
  let w = 0;
  for (let l = 1; l < layers.length; l++) {
    const src = act[l - 1];
    const dst = act[l];
    const fanIn = layers[l - 1];
    for (let j = 0; j < layers[l]; j++) {
      let sum = 0;
      for (let i = 0; i < fanIn; i++) sum += src[i] * weights[w++];
      sum += weights[w++];
      dst[j] = Math.tanh(sum);
    }
  }
  return act[layers.length - 1];
}
