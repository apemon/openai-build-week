# Implementation ownership

Shared contracts in `src/domain/**` and `src/realtime/CommunicatorTransport.ts` are frozen and owned by the root integrator. Contract changes require root coordination.

- `brain-api`: `src/agents/brain/**`, `src/app/api/brain/**`, Brain-specific tests and fixtures.
- `realtime-voice`: `src/realtime/**` except `CommunicatorTransport.ts`, `src/agents/communicator/**`, `src/app/api/realtime/**`, Realtime-specific tests and fixtures.
- `experience-demo`: `src/components/**`, `src/demo/**`, `src/export/**`, `public/demo-audio/**`, colocated UI tests.
- `verification-docs`: `tests/**` excluding module-owned fixtures, `README.md`, `.env.example`, test configs, `docs/demo-video-storyboard.md`.
- Root integrator: root configs, `src/app/layout.tsx`, `src/app/page.tsx`, shared contracts, integration wiring.
