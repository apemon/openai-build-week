# Use a Realtime Communicator with an authoritative GPT-5.6 Brain

Spec Grill will use `gpt-realtime-2.1` for natural voice transport, turn detection, transcription, and concise spoken delivery, while a server-side `gpt-5.6` Responses API call remains authoritative for specification analysis and the next-question decision. This hybrid preserves low-latency voice interaction without allowing an unconstrained voice model to bypass transcript review, invent decisions, or mutate the Specification; only Product Manager-confirmed text reaches the Brain.

## Consequences

The application must explicitly hand confirmed turns and validated Brain output across the agent boundary, label both agents' live output, and degrade to text-only interaction if the Realtime Communicator fails while the Brain remains available.
