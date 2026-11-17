export const COMPARE_DIAGRAM = `flowchart TB
  subgraph Usual["The usual ways to learn / test AWS"]
    A["Your code or the AWS CLI"] -->|"real calls, real bill"| R[("Real AWS sandbox account")]
    A -->|"hand-written fakes"| M["moto"]
    A -->|"Docker + account + auth token"| L["LocalStack"]
  end
  subgraph New["AWS Emulator"]
    B["Your code or the AWS CLI"] -->|"same SDK calls, AWS_ENDPOINT_URL"| E["AWS Emulator on 127.0.0.1<br/>generated from AWS API models"]
    E --> S[("in-memory state<br/>wiped on restart")]
    F[["published fidelity scores<br/>every release"]] -.->|"measured against real AWS"| E
  end
  E -. "when ready" .-> R`

export const ARCH_DIAGRAM = `flowchart LR
  subgraph Browser["Browser: React app"]
    UI["Manual + checker"]
    T["Terminal"]
    MAP["Live resource map"]
    TU["Tutor panel"]
  end
  subgraph Bun["Bun server"]
    RUN["Runner: aws only, no shell,<br/>env built from scratch"]
    CHK["Checkers: AWS SDK v3"]
    INV["Inventory poller (2 s)"]
    PRG["Progress JSON in DATA_DIR<br/>checks, break-it, quiz, time, exam readiness<br/>export / import"]
    CAP["Capability probe<br/>once per emulator image"]
    FED["File editor: writes only inside<br/>the module working folder"]
    EM["Emulator manager: docker run,<br/>health wait, cert + keys"]
    TUT["Tutor route: provider-agnostic<br/>(AI SDK), your key per request,<br/>never logged or stored"]
  end
  T --> RUN
  UI --> PRG
  UI --> FED
  CAP --> E
  UI --> CHK
  MAP --> INV
  TU --> TUT
  RUN -->|"HTTPS, SigV4"| E[("AWS Emulator<br/>Docker, 127.0.0.1:9297")]
  CHK --> E
  CHK --> PRG
  EM --> CAP
  INV --> E
  EM --> E
  TUT -->|"HTTPS"| API["Your provider: Anthropic, OpenAI,<br/>Gemini, OpenRouter or a local<br/>OpenAI-compatible server"]`
