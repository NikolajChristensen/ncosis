declare module "signalsmith-stretch" {
  export default function SignalsmithStretch(
    ctx: BaseAudioContext,
    options?: AudioWorkletNodeOptions,
  ): Promise<AudioWorkletNode & {
    schedule(o: object): void
    start(when?: number): void
    stop(when?: number): void
    latency(): Promise<number>
  }>
}
