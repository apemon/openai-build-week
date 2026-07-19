# Use direct Realtime WebRTC behind an adapter

The MVP will use the browser's native `RTCPeerConnection` and Realtime event data channel behind a typed `CommunicatorTransport` interface instead of depending on a higher-level voice SDK. The transcript review gate requires explicit control over semantic VAD, automatic-response suppression, microphone tracks, out-of-band spoken prompts, and recovery; the adapter preserves a future migration path once an SDK exposes every required control through documented behavior.
