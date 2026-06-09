## ADDED Requirements

### Requirement: Review detail supports process graph entry
The review history detail experience SHALL include a process graph entry that loads workflow data for the selected review attempt on demand.

#### Scenario: Process graph tab is available
- **WHEN** a user opens a review attempt detail
- **THEN** the detail experience SHALL provide a process graph tab or equivalent entry alongside issues, summary, agents, and raw materials

#### Scenario: Process graph preserves issue navigation
- **WHEN** a user opens an issue from the process graph inspector
- **THEN** the detail experience SHALL navigate to or reveal the corresponding issue detail without closing the review detail
