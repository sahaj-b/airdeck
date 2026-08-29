import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';

export function LoadingScreen() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardDescription className="text-[11px] font-bold tracking-[0.16em] uppercase">
            Airdeck host
          </CardDescription>
          <CardTitle className="text-xl">Loading dashboard…</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-[shimmer_1.2s_ease-in-out_infinite] rounded-full bg-primary/60" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
