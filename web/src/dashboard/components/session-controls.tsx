import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Switch } from '../../components/ui/switch';
import type { AdminState } from '../../shared/contracts';

interface SessionControlsProps {
  state: AdminState;
  onJoinsChange: (value: boolean) => void;
  onNewSession: () => void;
}

export function SessionControls({
  state,
  onJoinsChange,
  onNewSession,
}: SessionControlsProps) {
  return (
    <Card>
      <CardHeader>
        <div className="eyebrow">Session</div>
        <h2>Admission controls</h2>
        <p>Closing joins leaves active players connected.</p>
      </CardHeader>
      <CardContent>
        <div className="control-row">
          <label className="switch-label" htmlFor="accepting-joins">
            <Switch
              id="accepting-joins"
              checked={state.acceptingJoins}
              onCheckedChange={(checked) => onJoinsChange(checked)}
            />
            <span>
              <strong>
                {state.acceptingJoins ? 'Accepting new joins' : 'Joins closed'}
              </strong>
              <small>
                {state.acceptingJoins
                  ? 'Phones can enter the session.'
                  : 'Existing players are unaffected.'}
              </small>
            </span>
          </label>
          <Button type="button" variant="destructive" onClick={onNewSession}>
            Start new session
          </Button>
        </div>
        <p className="muted session-note">
          Starting a new session rotates the code, closes every player, destroys
          their virtual controllers, and opens admission again.
        </p>
      </CardContent>
    </Card>
  );
}
