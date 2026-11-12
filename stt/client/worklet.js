/* RETINA STT: AudioWorklet that forwards each mono Float32 block to the main thread. */
class RetinaPcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    var ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice());
    return true;
  }
}
registerProcessor('retina-pcm', RetinaPcmProcessor);
