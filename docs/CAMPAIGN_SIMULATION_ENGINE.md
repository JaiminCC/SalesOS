# Campaign simulation engine

`campaign-simulation/start` is allowed from `SCHEDULED`. It creates a run, enrolls eligible verified identities, writes exclusions for everyone else, and inserts `campaign.simulation.run.v1`. The payload records the acting user. The worker refuses the job when the tenant is suspended or the user no longer has `campaigns.simulate`.

Each advance is idempotent on the step key. A repeated delivery does not add another execution or another draft for that step. Personalization is idempotent per campaign and contact. Pause, cancel, and archive stop further advancement. Cancellation marks open enrollments cancelled.

The monitor reads enrollments, executions, and draft state from PostgreSQL. A completed simulation is labeled simulation. It is not labeled delivered. `sendAttempts` on the campaign job result is always 0.
