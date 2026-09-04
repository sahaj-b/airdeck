import { useStore } from 'zustand';
import './stick-feel.css';
import { SectionHeader } from './section-header';
import type { MountOptions } from './settings-island';
import type { StickFeelSetting, StickGrabSetting } from './settings-store';

const FEEL_COPY: Record<StickFeelSetting, { title: string; sub: string }> = {
  fixed: { title: 'Stay put', sub: 'You find the stick' },
  floating: { title: 'Jump to thumb', sub: 'Stick meets you' },
  following: { title: 'Jump & Glide', sub: 'Center stays close' },
};

const GRAB_COPY: Record<StickGrabSetting, { title: string; sub: string }> = {
  wide: { title: 'Grab anywhere', sub: 'Any empty space grabs' },
  precise: { title: 'Stick only', sub: 'Empty space ignores' },
};

const segWrap = (cols: string) =>
  `grid ${cols} gap-1 rounded-xl bg-muted p-1 ring-1 ring-border shadow-[inset_0_2px_4px_rgb(0_0_0/0.35)]`;

const segBtn = (active: boolean) =>
  `transition-colors active:scale-[0.98] ${
    active
      ? 'bg-white/[0.09] shadow-[0_1px_2px_rgb(0_0_0/0.45),inset_0_1px_0_rgb(255_255_255/0.12)] ring-1 ring-white/15'
      : 'hover:bg-white/[0.06]'
  }`;

export function StickFeelSettings({ opts }: { opts: MountOptions }) {
  const store = opts.store;
  const feel = useStore(store, (s) => s.stickFeel);
  const grab = useStore(store, (s) => s.stickGrab);
  const gyroEnabled = useStore(store, (s) => s.gyroEnabled);
  const gyroTarget = useStore(store, (s) => s.gyroTarget);
  const gyroMode = useStore(store, (s) => s.gyroMode);
  const setFeel = useStore(store, (s) => s.setStickFeel);
  const setGrab = useStore(store, (s) => s.setStickGrab);

  return (
    <div>
      <SectionHeader>Joystick Feel</SectionHeader>
      <div className="space-y-3 pt-3">
        {gyroEnabled && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed">
            Gyro drives {gyroTarget === 'leftStick' ? 'left' : 'right'} stick (
            {gyroMode}). Touch still works, but tilt owns that stick.
          </p>
        )}
        <fieldset className={segWrap('grid-cols-3')}>
          <legend className="sr-only">Joystick feel</legend>
          {(Object.keys(FEEL_COPY) as StickFeelSetting[]).map((value) => {
            const active = feel === value;
            const copy = FEEL_COPY[value];
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                aria-label={`Stick feel ${copy.title}`}
                onClick={() => setFeel(value)}
                className={`flex flex-col items-center gap-1.5 rounded-lg px-1 py-2.5 text-center text-foreground ${segBtn(active)}`}
              >
                <span
                  className={`stick-mini stick-mini--${value}`}
                  aria-hidden="true"
                >
                  <span className="stick-mini-base">
                    <span className="stick-mini-thumb" />
                  </span>
                </span>
                <span className="text-xs font-semibold leading-none">
                  {copy.title}
                </span>
                <span className="text-[10px] leading-tight text-muted-foreground">
                  {copy.sub}
                </span>
              </button>
            );
          })}
        </fieldset>
        {feel !== 'fixed' && (
          <fieldset className={segWrap('grid-cols-2')}>
            <legend className="sr-only">Grab area</legend>
            {(Object.keys(GRAB_COPY) as StickGrabSetting[]).map((value) => {
              const active = grab === value;
              const copy = GRAB_COPY[value];
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  aria-label={`Grab area ${copy.title}`}
                  onClick={() => setGrab(value)}
                  className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-left text-foreground ${segBtn(active)}`}
                >
                  <span
                    className={`grab-thumb grab-thumb--${value}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold leading-tight">
                      {copy.title}
                    </span>
                    <span className="block text-[10px] leading-tight text-muted-foreground">
                      {copy.sub}
                    </span>
                  </span>
                </button>
              );
            })}
          </fieldset>
        )}
      </div>
    </div>
  );
}
