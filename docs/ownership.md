# Implementation ownership

Shared V1/V2 contracts in `src/domain/**` and `src/realtime/CommunicatorTransport.ts` are frozen and owned by the root integrator. They include Project Context Digest provenance, Question Roadmap dependencies, one Lookahead approval, Decision Summary queue/staleness, preparation phases, reducer events, API request ordering, and processing stages. Contract changes require root coordination.

- `brain-api`: `src/agents/brain/**`, `src/app/api/brain/**`, Brain-specific tests and fixtures. It consumes but does not edit the frozen shared contracts.
- `realtime-voice`: `src/realtime/**` except `CommunicatorTransport.ts`, `src/agents/communicator/**`, `src/app/api/realtime/**`, Realtime-specific tests and fixtures. It consumes but does not edit the frozen shared contracts.
- `experience-demo`: `src/components/**`, `src/demo/**`, `src/export/**`, `src/context/**`, `src/app/api/context/**`, `public/demo-audio/**`, colocated UI/context tests. It consumes but does not edit the frozen shared contracts.
- `verification-docs`: `tests/**` excluding module-owned fixtures, `README.md`, `.env.example`, test configs, `docs/demo-video-storyboard.md`.
- Root integrator: root configs, `src/app/layout.tsx`, `src/app/page.tsx`, shared contracts, integration wiring.
