import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Label } from '../../components/ui/label';
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
    <Card className="flex flex-col">
      <CardHeader>
        <CardDescription className="text-[11px] font-bold tracking-[0.16em] uppercase">
          Session
        </CardDescription>
        <CardTitle className="text-lg">Admission controls</CardTitle>
        <CardDescription>
          Closing joins leaves active players connected.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-6">
        <div className="flex items-center justify-between gap-4 rounded-lg border bg-card px-4 py-3">
          <div className="flex items-center gap-3">
            <Switch
              id="accepting-joins"
              checked={state.acceptingJoins}
              onCheckedChange={(checked) => onJoinsChange(checked)}
            />
            <Label
              htmlFor="accepting-joins"
              className="flex flex-col items-start gap-0.5 cursor-pointer"
            >
              <span className="text-sm font-medium leading-none">
                {state.acceptingJoins ? 'Accepting new joins' : 'Joins closed'}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {state.acceptingJoins
                  ? 'Phones can enter the session.'
                  : 'Existing players are unaffected.'}
              </span>
            </Label>
          </div>
        </div>

        <div className="space-y-3">
          <Button
            type="button"
            variant="destructive"
            className="w-full"
            onClick={onNewSession}
          >
            Start new session
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Rotates the code, closes every player, destroys their virtual
            controllers, and opens admission again.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
