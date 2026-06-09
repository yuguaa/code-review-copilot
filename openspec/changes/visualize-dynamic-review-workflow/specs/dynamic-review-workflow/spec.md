## ADDED Requirements

### Requirement: Dynamic workflow nodes
The system SHALL persist dynamic workflow nodes for a review as the review progresses, starting with a trigger node and then adding or updating nodes for each main review step and Agent Loop stage.

#### Scenario: Trigger node is created first
- **WHEN** a manual, retry, MR webhook, or Push webhook review log is created
- **THEN** the system SHALL persist exactly one initial trigger workflow node for that review before the asynchronous review execution begins

#### Scenario: Main step node is updated
- **WHEN** a main review step starts and then completes
- **THEN** the system SHALL first mark that step node as running and later update the same node to success with completion time and metrics

#### Scenario: Review fails during a step
- **WHEN** a main review step or Agent Loop stage throws an error
- **THEN** the system SHALL mark the active workflow node as failed and create a failed finish node without inventing fallback paths

#### Scenario: Review is stopped
- **WHEN** a pending review is manually stopped
- **THEN** the system SHALL mark all running workflow nodes for that review as cancelled and create a cancelled finish node

### Requirement: Agent workflow visibility
The system SHALL expose Agent Loop stages as workflow nodes that dynamically reflect context, plan, tool, review, validation, critic, finish, and error progress.

#### Scenario: Agent stage event becomes node
- **WHEN** the Agent Loop records a trace event for a stage
- **THEN** the system SHALL upsert a workflow node for that bot run, iteration, and stage with matching status, title, detail, duration, and metrics

#### Scenario: Auxiliary Agent appears only when called
- **WHEN** the primary Agent actually invokes additional review agents
- **THEN** the system SHALL create auxiliary Agent workflow nodes and connect them to the primary Agent tool stage

#### Scenario: Auxiliary Agent is not called
- **WHEN** no additional review agent is invoked
- **THEN** the system SHALL NOT create workflow nodes for inactive auxiliary agent configurations

### Requirement: Workflow API
The system SHALL provide a workflow API that returns the current workflow snapshot for a single review.

#### Scenario: Workflow snapshot returned
- **WHEN** a client requests `GET /api/reviews/{id}/workflow` for an existing review with workflow nodes
- **THEN** the system SHALL return review status, latest update time, ordered nodes, and generated edges

#### Scenario: Missing review fails fast
- **WHEN** a client requests workflow for a nonexistent review id
- **THEN** the system SHALL return a not found response

#### Scenario: Missing workflow fails fast
- **WHEN** a client requests workflow for an existing review that has no workflow nodes
- **THEN** the system SHALL return a not found response instead of fabricating nodes

### Requirement: Interactive workflow visualization
The system SHALL show an interactive React Flow visualization in the review detail experience.

#### Scenario: Workflow graph updates while running
- **WHEN** a review detail is open and the review is pending
- **THEN** the client SHALL poll the workflow API and update nodes and edges until the review reaches completed, failed, or cancelled

#### Scenario: Node details are inspectable
- **WHEN** a user clicks a workflow node
- **THEN** the client SHALL show node status, summary, detail, metrics, raw data, and related issues in an inspector panel

#### Scenario: Issues are clickable
- **WHEN** a node inspector lists related review issues
- **THEN** each issue SHALL provide an interaction to open the GitLab line when available and an interaction to jump to the local issue detail in the review dialog

#### Scenario: React Flow is not loaded for list-only viewing
- **WHEN** a user only views the reviews list
- **THEN** the React Flow package SHALL NOT be included in the initial reviews list client bundle

### Requirement: Review history data separation
The system SHALL separate review list summary data from detail and workflow data.

#### Scenario: Review list uses summary payload
- **WHEN** the reviews list loads
- **THEN** it SHALL receive only list and attempt summary fields, not raw prompts, raw AI responses, or full Agent trace payloads

#### Scenario: Review detail loads on demand
- **WHEN** a user opens a specific review attempt
- **THEN** the client SHALL load detail fields for that review attempt from a detail API before showing full comments, raw materials, and workflow interactions
