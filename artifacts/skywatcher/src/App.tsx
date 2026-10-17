import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { useGetSkySnapshot, getGetSkySnapshotQueryKey, useHealthCheck, getHealthCheckQueryKey } from '@workspace/api-client-react';
import type { ConstellationSummary, DeepSkyPosition, SolarPosition } from '@workspace/api-client-react';
import { Activity, ArrowDownWideNarrow, ArrowUpRight, Check, ChevronDown, Clock3, Compass, Crosshair, Filter, Globe2, LocateFixed, MapPin, Menu, Orbit, RefreshCw, Search, Settings2, SlidersHorizontal, Sparkles, Telescope } from 'lucide-react';
import NotFound from '@/pages/not-found';
import './index.css';

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 } } });
const skywatchLogo = `${import.meta.env.BASE_URL}skywatch-logo.png`;
type Filters = { minAltitude: number; direction: string; maxMagnitude: number; equipment: string };
const equipmentLimits: Record<string, number> = { 'Naked Eye': 4, Binoculars: 6, Telescope: 14 };
const defaultFilters: Filters = { minAltitude: 15, direction: 'Any direction', maxMagnitude: 6, equipment: 'Binoculars' };
const routes = [
  { href: '/', label: 'Live sky', icon: Orbit },
  { href: '/solar-system', label: 'Solar system', icon: Sparkles },
  { href: '/deep-sky', label: 'Deep sky', icon: Telescope },
  { href: '/constellations', label: 'Constellations', icon: Compass },
  { href: '/filters', label: 'Observing filters', icon: SlidersHorizontal },
];

const fmtTime = (value: string | null | undefined, timezone: string) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
};
const fmtDate = (value: string, timezone: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
};
const fmtAltitude = (value: number) => `${value.toFixed(1)}°`;
const directionKey = (value: string) => {
  const compact = value.toLowerCase().replace(/[^a-z]/g, '');
  return ({ n: 'north', north: 'north', ne: 'northeast', northeast: 'northeast', e: 'east', east: 'east', se: 'southeast', southeast: 'southeast', s: 'south', south: 'south', sw: 'southwest', southwest: 'southwest', w: 'west', west: 'west', nw: 'northwest', northwest: 'northwest' } as Record<string, string>)[compact] || compact;
};
const directionPass = (compass: string, preference: string) => preference === 'Any direction' || directionKey(compass) === directionKey(preference);
const filterDeepSky = (items: DeepSkyPosition[], filters: Filters, visibleOnly: boolean, query: string) => items
  .filter(item => !visibleOnly || (item.isUp && item.altitude >= filters.minAltitude))
  .filter(item => item.magnitude <= filters.maxMagnitude && directionPass(item.compass, filters.direction))
  .filter(item => `${item.name} ${item.kind}`.toLowerCase().includes(query.toLowerCase()))
  .sort((a, b) => b.altitude - a.altitude);

function StatusPill({ children, tone = 'cyan' }: { children: ReactNode; tone?: 'cyan' | 'gold' | 'violet' | 'muted' }) {
  const style = tone === 'gold' ? 'border-amber-200/20 bg-amber-300/10 text-amber-200' : tone === 'violet' ? 'border-violet-200/20 bg-violet-300/10 text-violet-200' : tone === 'muted' ? 'border-slate-400/15 bg-slate-300/5 text-slate-400' : 'border-cyan-200/20 bg-cyan-300/10 text-cyan-200';
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium tracking-wide ${style}`}>{children}</span>;
}
function Metric({ label, value, detail, accent = 'cyan' }: { label: string; value: string | number; detail: string; accent?: 'cyan' | 'violet' | 'gold' }) {
  const colors = { cyan: 'text-cyan-200', violet: 'text-violet-200', gold: 'text-amber-200' };
  return <div className="glass rounded-2xl p-5"><div className="eyebrow">{label}</div><div className={`mt-3 font-serif text-4xl font-semibold tracking-tight ${colors[accent]}`}>{value}</div><div className="mt-2 text-xs text-slate-500">{detail}</div></div>;
}
function PageHeading({ kicker, title, sub, action }: { kicker: string; title: ReactNode; sub: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="eyebrow mb-2">{kicker}</div><h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-100 sm:text-[38px]">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{sub}</p></div>{action}</div>;
}
function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3" aria-label="Loading sky data">{Array.from({ length: rows }, (_, i) => <div key={i} className="glass h-[72px] animate-pulse rounded-xl bg-slate-700/10" />)}</div>;
}
function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="glass flex min-h-48 flex-col items-center justify-center rounded-2xl px-6 text-center"><div className="mb-3 rounded-full border border-slate-500/20 bg-slate-400/5 p-3 text-slate-400"><Telescope size={20} /></div><h3 className="text-sm font-semibold text-slate-200">{title}</h3><p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{body}</p></div>;
}

function LocationSetup({ value, onChange, onSubmit, isLoading, isError, errorMessage, onRetry }: { value: string; onChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; isLoading: boolean; isError: boolean; errorMessage: string; onRetry: () => void }) {
  return <div className="sky-shell shell-content relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-12">
    <div className="glass fade-up relative w-full max-w-xl rounded-3xl p-6 sm:p-10">
      <div className="mb-8 flex flex-col items-center gap-2">
        <img src={skywatchLogo} alt="Skywatch satellite dish logo" width={1024} height={1024} className="h-32 w-32 rounded-2xl border border-slate-300/10 bg-black object-contain shadow-[0_12px_40px_rgba(0,0,0,.3)]" />
        <div className="font-serif text-base font-bold tracking-[.1em] text-slate-100">SKYWATCH</div>
        <div className="eyebrow !text-[8px] !tracking-[.2em]">Your personal planetarium</div>
      </div>
      <div className="eyebrow mb-3 flex items-center gap-2"><LocateFixed size={13} className="text-cyan-200" /> Observer location</div>
      <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight text-slate-100 sm:text-4xl">Where are you looking up from?</h1>
      <p className="mt-3 max-w-lg text-sm leading-6 text-slate-400">Enter your city or coordinates to calculate the live sky above you. We’ll use your location’s timezone and open your observing board.</p>
      <form onSubmit={onSubmit} className="mt-7 space-y-3" aria-busy={isLoading}>
        <label htmlFor="setup-location" className="eyebrow block !text-[9px]">City or latitude, longitude</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <MapPin size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-cyan-200" />
            <input id="setup-location" required autoComplete="off" value={value} onChange={event => onChange(event.target.value)} placeholder="e.g. Greenwich, London or 51.48, -0.004" className="w-full rounded-xl border border-slate-300/15 bg-[#0b111b]/90 py-3.5 pl-10 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-200/40" data-testid="input-first-location" />
          </div>
          <button type="submit" disabled={!value.trim() || isLoading} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-cyan-200 px-5 text-sm font-semibold text-[#0a141b] transition hover:bg-cyan-100 disabled:cursor-wait disabled:opacity-70" data-testid="button-find-my-sky">
            {isLoading ? <><RefreshCw size={15} className="animate-spin" /> Finding your sky</> : <>Find my sky <ArrowUpRight size={15} /></>}
          </button>
        </div>
      </form>
      {isLoading && <div role="status" className="mt-4 flex items-center gap-2 text-xs text-cyan-100"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-200" />Resolving your location and calculating the local sky…</div>}
      {isError && <div role="alert" className="mt-4 flex flex-col gap-3 rounded-xl border border-rose-200/20 bg-rose-200/[.06] p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-5 text-rose-100/90">{errorMessage}</p><button type="button" onClick={onRetry} className="shrink-0 rounded-lg border border-rose-100/20 px-3 py-2 text-xs text-rose-100 transition hover:bg-rose-100/10" data-testid="button-retry-location">Try again</button></div>}
      <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-300/[.08] pt-5 text-[10px] text-slate-500"><span className="flex items-center gap-2"><Compass size={13} className="text-violet-200" />City lookup supported</span><span className="flex items-center gap-2"><Crosshair size={13} className="text-cyan-200" />Coordinates supported</span><span className="flex items-center gap-2"><Clock3 size={13} className="text-amber-200" />Automatic local timezone</span></div>
    </div>
  </div>;
}

function AppFrame() {
  const [path, navigate] = useLocation();
  const [initialLocation] = useState(() => localStorage.getItem('skywatcher-location') || '');
  const [locationInput, setLocationInput] = useState(initialLocation);
  const [submittedLocation, setSubmittedLocation] = useState(initialLocation);
  const [hasCompletedSetup, setHasCompletedSetup] = useState(Boolean(initialLocation));
  const [filters, setFilters] = useState<Filters>(() => {
    try { return { ...defaultFilters, ...JSON.parse(localStorage.getItem('skywatcher-filters') || '{}') }; } catch { return defaultFilters; }
  });
  const [showLocation, setShowLocation] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 60_000 } });
  const sky = useGetSkySnapshot({ location: submittedLocation }, { query: { queryKey: getGetSkySnapshotQueryKey({ location: submittedLocation }), enabled: Boolean(submittedLocation), refetchInterval: 60_000, refetchIntervalInBackground: true } });
  const snapshot = sky.data;
  const timezone = snapshot?.location.timezone || 'UTC';
  const isActive = (href: string) => href === '/' ? path === '/' : path.startsWith(href);
  useEffect(() => {
    if (!submittedLocation || !snapshot) return;
    localStorage.setItem('skywatcher-location', submittedLocation);
    if (!hasCompletedSetup) {
      setHasCompletedSetup(true);
      navigate('/');
    }
  }, [submittedLocation, snapshot, hasCompletedSetup, navigate]);
  const submitLocation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = locationInput.trim();
    if (!value) return;
    if (value === submittedLocation && sky.isError) {
      void sky.refetch();
      return;
    }
    setSubmittedLocation(value);
    setShowLocation(false);
  };
  const returnToLocationSetup = () => {
    setSubmittedLocation('');
    setHasCompletedSetup(false);
    setShowLocation(false);
  };
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    localStorage.setItem('skywatcher-filters', JSON.stringify(next));
  };
  const setEquipment = (equipment: string) => {
    const next = { ...filters, equipment, maxMagnitude: equipmentLimits[equipment] ?? 6 };
    setFilters(next);
    localStorage.setItem('skywatcher-filters', JSON.stringify(next));
  };
  const refresh = () => sky.refetch();
  const apiDown = health.isError;

  if (!hasCompletedSetup) {
    return <LocationSetup
      value={locationInput}
      onChange={setLocationInput}
      onSubmit={submitLocation}
      isLoading={Boolean(submittedLocation) && sky.isFetching}
      isError={Boolean(submittedLocation) && sky.isError}
      errorMessage={sky.error instanceof Error ? sky.error.message : 'We could not load the sky for that location. Check the city or coordinate format and try again.'}
      onRetry={() => { void sky.refetch(); }}
    />;
  }

  return <div className="sky-shell shell-content">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-slate-300/[.08] bg-[#0d1420]/90 px-4 py-6 backdrop-blur-xl lg:flex">
      <Link href="/" aria-label="Skywatch home" className="mb-8 flex items-center gap-3 px-2 text-inherit no-underline">
        <img src={skywatchLogo} alt="" width={1024} height={1024} className="h-12 w-12 shrink-0 rounded-xl border border-slate-300/10 bg-black object-contain" />
        <div><div className="font-serif text-[17px] font-bold tracking-[.08em] text-slate-100">SKYWATCH</div><div className="eyebrow mt-0.5 !text-[8px] !tracking-[.21em]">Observing instrument</div></div>
      </Link>
      <div className="mb-2 px-3 eyebrow">Observing desk</div>
      <nav className="space-y-1" aria-label="Main navigation">{routes.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-${label.toLowerCase().replaceAll(' ', '-')}`} className={`nav-link flex items-center gap-3 rounded-xl border border-transparent px-3 py-3 text-[13px] font-medium no-underline ${isActive(href) ? 'active' : 'text-slate-400'}`}><Icon size={17} strokeWidth={1.7} /><span>{label}</span>{href === '/' && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-200" />}</Link>)}</nav>
      <div className="mt-auto">
        <div className="glass rounded-xl p-4">
           <div className="flex items-center justify-between"><span className="eyebrow !text-[9px]">Signal</span><span className={`flex items-center gap-1.5 text-[10px] ${health.isError ? 'text-rose-300' : 'text-emerald-200'}`}><span className={`h-1.5 w-1.5 rounded-full ${health.isError ? 'bg-rose-300' : 'bg-emerald-300'}`} />{health.isError ? 'Unavailable' : health.isLoading ? 'Connecting' : 'Connected'}</span></div>
          <p className="mt-2 text-[11px] leading-5 text-slate-500">{health.isError ? 'Sky service is not responding. Data may be out of date.' : 'Live ephemeris link active. Positions refresh each minute.'}</p>
        </div>
        <div className="mt-4 flex items-center gap-2 px-2 text-[10px] text-slate-600"><Activity size={12} /> SKY SERVICE <span className="mono ml-auto">v0.1</span></div>
      </div>
    </aside>
    <header className="sticky top-0 z-20 border-b border-slate-300/[.08] bg-[#0b111b]/85 backdrop-blur-xl lg:ml-[248px]">
      <div className="mx-auto flex h-[68px] max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-7 xl:px-10">
        <div className="flex items-center gap-3">
          <button onClick={() => setMobileMenu(!mobileMenu)} className="rounded-lg border border-slate-400/15 p-2 text-slate-300 lg:hidden" aria-label="Toggle navigation"><Menu size={18} /></button>
          <Link href="/" aria-label="Skywatch home" className="flex min-h-11 shrink-0 items-center gap-2 text-inherit no-underline lg:hidden"><img src={skywatchLogo} alt="" width={1024} height={1024} className="h-10 w-10 shrink-0 rounded-lg border border-slate-300/10 bg-black object-contain" /><span className="hidden font-serif text-sm font-bold tracking-[.13em] text-slate-100 md:inline">SKYWATCH</span></Link>
          <div className="hidden items-center gap-2 text-xs text-slate-400 lg:flex"><span className="text-slate-600">Desk</span><span>/</span><span className="text-slate-200">{routes.find(item => isActive(item.href))?.label}</span></div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={() => setShowLocation(!showLocation)} className="flex max-w-[112px] items-center gap-2 rounded-xl border border-slate-300/10 bg-slate-300/[.035] px-3 py-2 text-left text-xs text-slate-300 hover:border-cyan-200/20 sm:max-w-[150px] md:max-w-[190px]" data-testid="button-location"><MapPin size={14} className="shrink-0 text-cyan-200" /><span className="truncate">{snapshot?.location.name || submittedLocation}</span><ChevronDown size={13} className="shrink-0 text-slate-500" /></button>
          <button onClick={refresh} disabled={sky.isFetching} className="flex h-9 items-center gap-2 rounded-xl border border-slate-300/10 px-3 text-xs text-slate-300 transition hover:border-cyan-200/25 hover:text-cyan-100 disabled:opacity-50" data-testid="button-refresh"><RefreshCw size={14} className={sky.isFetching ? 'animate-spin' : ''} /><span className="hidden sm:inline">Refresh</span></button>
          <div className="hidden h-8 w-px bg-slate-300/10 sm:block" />
          <div className="hidden text-right sm:block"><div className="mono text-[11px] text-slate-200">{snapshot ? fmtDate(snapshot.observedAt, timezone) : 'Local sky time'}</div><div className="eyebrow mt-1 !text-[8px]">{snapshot?.location.timezone || 'Location timezone'}</div></div>
        </div>
      </div>
      {showLocation && <form onSubmit={submitLocation} className="absolute right-4 top-[58px] z-50 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-slate-300/15 bg-[#121b2a] p-4 shadow-2xl sm:right-8"><label className="eyebrow mb-2 block" htmlFor="location-input">Observer location</label><div className="flex gap-2"><input id="location-input" value={locationInput} onChange={e => setLocationInput(e.target.value)} placeholder="City or latitude,longitude" className="min-w-0 flex-1 rounded-lg border border-slate-300/15 bg-[#0b111b] px-3 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-200/40" data-testid="input-location" /><button className="rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-[#0a141b] hover:bg-cyan-100" data-testid="button-submit-location">Set</button></div><p className="mt-2 text-[10px] text-slate-500">Use a city name or coordinates. The returned location sets the observing timezone.</p><div className="mt-3 border-t border-slate-300/10 pt-3"><button type="button" onClick={returnToLocationSetup} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-cyan-100 transition hover:bg-cyan-200/[.06]" data-testid="button-back-to-location-setup"><LocateFixed size={14} />Back to location setup</button></div></form>}
      {mobileMenu && <nav className="grid grid-cols-2 gap-1 border-t border-slate-300/10 px-4 py-3 lg:hidden">{routes.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileMenu(false)} className={`nav-link flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs no-underline ${isActive(href) ? 'active' : 'text-slate-400'}`}><Icon size={15} />{label}</Link>)}</nav>}
    </header>
    <main className="mx-auto min-h-[calc(100dvh-68px)] max-w-[1600px] px-4 py-7 sm:px-7 sm:py-9 lg:ml-[248px] xl:px-10">
      {apiDown && <div role="status" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-rose-200/20 bg-rose-300/[.07] px-4 py-3 text-xs text-rose-100"><span>Sky service connection is unavailable. Reconnect and refresh to update the observing data.</span><button onClick={() => health.refetch()} className="rounded-lg border border-rose-200/15 px-3 py-1.5 hover:bg-rose-200/10">Retry</button></div>}
      {sky.isError && <div className="mb-5 rounded-xl border border-amber-200/20 bg-amber-200/[.06] p-4 text-sm text-amber-100" role="alert"><div className="flex items-center gap-2 font-semibold"><Globe2 size={16} /> Location or sky data unavailable</div><p className="mt-1 text-xs text-amber-100/65">Could not retrieve the sky for “{submittedLocation}”. Check the location and try again.</p><button onClick={() => { setShowLocation(true); }} className="mt-3 rounded-lg border border-amber-100/20 px-3 py-1.5 text-xs hover:bg-amber-100/10">Change location</button><button onClick={refresh} className="ml-2 rounded-lg border border-amber-100/20 px-3 py-1.5 text-xs hover:bg-amber-100/10">Retry</button></div>}
      {path === '/' && <Overview snapshot={snapshot} isLoading={sky.isLoading} filters={filters} />}
      {path === '/solar-system' && <SolarSystem snapshot={snapshot} isLoading={sky.isLoading} filters={filters} />}
      {path === '/deep-sky' && <DeepSky snapshot={snapshot} isLoading={sky.isLoading} filters={filters} />}
      {path === '/constellations' && <Constellations snapshot={snapshot} isLoading={sky.isLoading} filters={filters} />}
       {path === '/filters' && <FilterPage filters={filters} setFilter={setFilter} setEquipment={setEquipment} counts={snapshot?.counts} />}
    </main>
    <footer className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 pb-7 text-[10px] text-slate-600 sm:px-7 lg:ml-[248px] xl:px-10">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" aria-label="Skywatch home" className="flex min-h-[52px] shrink-0 items-center gap-2 rounded-md pr-2 text-inherit no-underline hover:text-slate-300">
          <img src={skywatchLogo} alt="" width={1024} height={1024} className="h-[52px] w-[52px] rounded-xl border border-slate-300/10 bg-black object-contain" />
          <span className="font-serif text-[11px] font-bold tracking-[.12em] text-slate-300">SKYWATCH</span>
        </Link>
        <span className="hidden sm:inline">Sky positions are calculated for the selected observer location.</span>
      </div>
      <span className="mono shrink-0">AUTOMATIC UPDATE · 60 SEC</span>
    </footer>
  </div>;
}

function DataState({ isLoading, hasData, emptyTitle, children }: { isLoading: boolean; hasData: boolean; emptyTitle: string; children: ReactNode }) {
  if (isLoading) return <Skeleton />;
  if (!hasData) return <EmptyState title={emptyTitle} body="There are no matching objects in this view for the selected location and observing filters." />;
  return <>{children}</>;
}

function Overview({ snapshot, isLoading, filters }: { snapshot?: import('@workspace/api-client-react').SkySnapshot; isLoading: boolean; filters: Filters }) {
  const timezone = snapshot?.location.timezone || 'UTC';
  const rising = snapshot?.solar.filter(item => item.isUp).length ?? 0;
  const objects = snapshot ? filterDeepSky(snapshot.messier, filters, true, '') : [];
  return <div className="fade-up">
    <PageHeading kicker="Live observing report" title="Live" sub={snapshot ? `A live, location-aware view from ${snapshot.location.name}. Positions are calculated for ${snapshot.location.latitude.toFixed(3)}°, ${snapshot.location.longitude.toFixed(3)}° and refresh every minute.` : 'Your observatory view, calibrated to the observer location.'} action={<div className="flex items-center gap-3" role="status" aria-label="Live sky data, refreshes every 60 seconds"><span className="inline-flex items-center gap-2 rounded-full border border-red-400/25 bg-red-500/[.08] px-3 py-1.5 text-[10px] font-semibold tracking-[.16em] text-red-200"><span className="relative inline-flex h-2 w-2"><span className="absolute inset-0 animate-ping rounded-full bg-red-500/55" /><span className="relative h-2 w-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,.9)]" /></span>LIVE</span><span className="hidden text-[10px] text-slate-500 sm:inline">REFRESHES EVERY 60S</span></div>} />
    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3"><Metric label="Solar system above horizon" value={snapshot ? `${rising} / ${snapshot.counts.solarTotal}` : '—'} detail="Sun, Moon & planets currently up" /><Metric label="Messier objects visible" value={snapshot ? `${snapshot.counts.deepSkyVisible}` : '—'} detail={`of ${snapshot?.counts.deepSkyTotal ?? '—'} catalogued objects`} accent="violet" /><Metric label="Constellations in view" value={snapshot?.counts.constellationsVisible ?? '—'} detail="With at least one visible star" accent="gold" /></div>
    <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
      <section className="glass overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-300/[.08] px-5 py-4"><div><div className="eyebrow">Local horizon</div><h2 className="mt-1 text-sm font-semibold text-slate-200">Current positions</h2></div><StatusPill><Crosshair size={11} /> Altitude / azimuth</StatusPill></div>
        <div className="soft-grid relative flex min-h-[350px] items-center justify-center overflow-hidden px-5 py-8">
          <div className="orbital relative aspect-square w-[min(78vw,330px)] rounded-full border border-cyan-200/15">
            <div className="absolute inset-[16%] rounded-full border border-slate-300/10" /><div className="absolute inset-[33%] rounded-full border border-slate-300/[.08]" /><div className="absolute inset-1/2 h-px w-[100%] -translate-y-1/2 bg-slate-300/[.08]" /><div className="absolute inset-1/2 h-[100%] w-px -translate-x-1/2 bg-slate-300/[.08]" />
            <span className="absolute left-1/2 top-2 -translate-x-1/2 eyebrow">N</span><span className="absolute right-2 top-1/2 -translate-y-1/2 eyebrow">E</span><span className="absolute bottom-2 left-1/2 -translate-x-1/2 eyebrow">S</span><span className="absolute left-2 top-1/2 -translate-y-1/2 eyebrow">W</span>
            <div className="absolute bottom-0 left-1/2 h-[1px] w-[72%] -translate-x-1/2 bg-gradient-to-r from-transparent via-cyan-200/30 to-transparent" />
            {snapshot?.solar.filter(item => item.isUp).map(item => <SkyDot key={item.name} name={item.name} altitude={item.altitude} azimuth={item.azimuth} color={item.kind.toLowerCase().includes('moon') ? '#f2d38a' : '#70dce7'} />)}
            {objects.slice(0, 18).map(item => <SkyDot key={item.name} name={item.name} altitude={item.altitude} azimuth={item.azimuth} color="#b4a2ff" small />)}
            {isLoading && <div className="absolute inset-0 animate-pulse rounded-full bg-cyan-200/[.02]" />}
          </div>
          {!isLoading && snapshot && snapshot.solar.filter(item => item.isUp).length === 0 && <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-slate-300/10 bg-[#0b111b]/80 px-3 py-1.5 text-[10px] text-slate-500">No solar system objects above horizon</div>}
          {!snapshot && isLoading && <div className="absolute bottom-5 text-[10px] text-slate-500">Waiting for location ephemeris…</div>}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-300/[.08] px-5 py-3 text-[10px] text-slate-500"><span className="flex items-center gap-2"><i className="h-1.5 w-1.5 rounded-full bg-cyan-200" />Solar system</span><span className="flex items-center gap-2"><i className="h-1.5 w-1.5 rounded-full bg-violet-300" />Messier objects</span><span className="ml-auto">Circle edge = horizon · center = zenith</span></div>
      </section>
      <div className="space-y-4">
        <section className="glass rounded-2xl p-5"><div className="flex items-center justify-between"><div><div className="eyebrow">Your station</div><h2 className="mt-2 flex items-center gap-2 text-base font-semibold text-slate-100"><MapPin size={15} className="text-cyan-200" />{snapshot?.location.name || 'Location pending'}</h2></div><button onClick={() => document.querySelector<HTMLButtonElement>('[data-testid="button-location"]')?.click()} className="rounded-lg border border-slate-300/10 p-2 text-slate-400 hover:text-cyan-200" aria-label="Edit location"><LocateFixed size={15} /></button></div><div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-300/[.08] pt-4"><div><div className="eyebrow !text-[9px]">Coordinates</div><div className="mono mt-1.5 text-[11px] text-slate-300">{snapshot ? `${snapshot.location.latitude.toFixed(3)}°, ${snapshot.location.longitude.toFixed(3)}°` : '—'}</div></div><div><div className="eyebrow !text-[9px]">Local sidereal context</div><div className="mono mt-1.5 text-[11px] text-slate-300">{snapshot?.location.timezone || '—'}</div></div></div></section>
        <section className="glass rounded-2xl p-5"><div className="flex items-center justify-between"><div><div className="eyebrow">Best placed now</div><h2 className="mt-1 text-sm font-semibold text-slate-200">Highest Messier objects</h2></div><Link href="/deep-sky" className="flex items-center gap-1 text-[10px] text-cyan-200 no-underline hover:text-cyan-100">Catalog <ArrowUpRight size={13} /></Link></div>
          {isLoading ? <div className="mt-4"><Skeleton rows={3} /></div> : objects.length === 0 ? <p className="mt-4 text-xs text-slate-500">No catalog objects currently meet your observing filters.</p> : <div className="mt-3 divide-y divide-slate-300/[.07]">{objects.slice(0, 4).map((item, i) => <div key={item.name} className="flex items-center gap-3 py-3"><span className="mono w-5 text-[10px] text-slate-600">0{i + 1}</span><div className="min-w-0 flex-1"><div className="text-xs font-medium text-slate-200">{item.name}</div><div className="mt-1 text-[10px] text-slate-500">{item.kind} · {item.compass}</div></div><div className="mono text-xs text-violet-200">{fmtAltitude(item.altitude)}</div></div>)}</div>}
        </section>
      </div>
    </div>
    <section className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="glass flex items-center gap-4 rounded-2xl p-5"><div className="rounded-xl border border-amber-200/15 bg-amber-200/[.06] p-3 text-amber-200"><Clock3 size={19} /></div><div><div className="eyebrow">Observation time</div><div className="mt-1 text-sm text-slate-200">{snapshot ? fmtDate(snapshot.observedAt, timezone) : isLoading ? 'Calculating…' : 'Unavailable'}</div><div className="mt-1 text-[10px] text-slate-500">Displayed in {snapshot?.location.timezone || 'observer'} time</div></div></div>
      <div className="glass flex items-center gap-4 rounded-2xl p-5"><div className="rounded-xl border border-cyan-200/15 bg-cyan-200/[.06] p-3 text-cyan-200"><Settings2 size={19} /></div><div className="min-w-0"><div className="eyebrow">Current observing limits</div><div className="mt-1 text-sm text-slate-200">Above {filters.minAltitude}° · {filters.direction}</div><div className="mt-1 text-[10px] text-slate-500">Limiting magnitude {filters.maxMagnitude} · {filters.equipment}</div></div><Link href="/filters" className="ml-auto shrink-0 text-[10px] text-cyan-200 no-underline">Adjust</Link></div>
    </section>
  </div>;
}

function SkyDot({ name, altitude, azimuth, color, small = false }: { name: string; altitude: number; azimuth: number; color: string; small?: boolean }) {
  const radius = 50 - Math.max(0, Math.min(90, altitude)) / 90 * 46;
  const radians = (azimuth - 90) * Math.PI / 180;
  const left = 50 + Math.cos(radians) * radius;
  const top = 50 + Math.sin(radians) * radius;
  return <div className="group absolute z-10" style={{ left: `${left}%`, top: `${top}%`, transform: 'translate(-50%,-50%)' }} title={`${name} · ${altitude.toFixed(1)}° altitude · azimuth ${azimuth.toFixed(1)}°`}><span className={`block rounded-full ${small ? 'h-1.5 w-1.5' : 'h-2.5 w-2.5'}`} style={{ backgroundColor: color, boxShadow: `0 0 12px ${color}99` }} /><span className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[#111927] px-1.5 py-1 text-[9px] text-slate-200 group-hover:block">{name}</span></div>;
}

function SolarSystem({ snapshot, isLoading, filters }: { snapshot?: import('@workspace/api-client-react').SkySnapshot; isLoading: boolean; filters: Filters }) {
  const items = snapshot?.solar.filter(item => item.altitude >= filters.minAltitude && item.magnitude <= filters.maxMagnitude && directionPass(item.compass, filters.direction)) || [];
  return <div className="fade-up"><PageHeading kicker="Ephemeris · local horizon" title="Solar system" sub="Rise, transit and set times are rendered in the selected location’s timezone. Altitude and compass bearing describe the current position." action={<StatusPill><Orbit size={12} /> {snapshot?.location.name || 'Observer location'}</StatusPill>} />
    <div className="mb-5 grid gap-3 sm:grid-cols-3"><Metric label="Currently above horizon" value={snapshot ? `${snapshot.solar.filter(x => x.isUp).length} / ${snapshot.counts.solarTotal}` : '—'} detail="Across the Sun, Moon & planets" /><Metric label="Highest altitude" value={snapshot && snapshot.solar.length ? fmtAltitude(Math.max(...snapshot.solar.map(x => x.altitude))) : '—'} detail="Current position" accent="gold" /><Metric label="Local time zone" value={snapshot?.location.timezone || '—'} detail={snapshot ? fmtDate(snapshot.observedAt, snapshot.location.timezone) : 'Location-based event times'} accent="violet" /></div>
    <div className="mb-3 hidden grid-cols-[1.2fr_.75fr_.8fr_1fr_1fr_1fr] gap-3 px-5 eyebrow md:grid"><span>Object</span><span>Altitude</span><span>Azimuth</span><span>Rise</span><span>Transit</span><span>Set</span></div>
    <DataState isLoading={isLoading} hasData={items.length > 0} emptyTitle="No solar objects meet these limits"><div className="space-y-2">{items.map(item => <SolarRow key={item.name} item={item} timezone={snapshot?.location.timezone || 'UTC'} />)}</div></DataState>
    <p className="mt-4 text-[10px] text-slate-600">Altitude and compass filters are applied. Event times are supplied by the sky service; unavailable events are shown as a dash.</p>
  </div>;
}
function SolarRow({ item, timezone }: { item: SolarPosition; timezone: string }) {
  const primary = item.kind.toLowerCase().includes('sun') ? 'gold' : item.kind.toLowerCase().includes('moon') ? 'violet' : 'cyan';
  return <div className="glass grid grid-cols-2 gap-x-4 gap-y-4 rounded-xl px-4 py-4 md:grid-cols-[1.2fr_.75fr_.8fr_1fr_1fr_1fr] md:items-center md:gap-3 md:px-5">
    <div className="col-span-2 flex items-center gap-3 md:col-span-1"><div className={`flex h-9 w-9 items-center justify-center rounded-xl border ${primary === 'gold' ? 'border-amber-200/15 bg-amber-200/[.06] text-amber-200' : primary === 'violet' ? 'border-violet-200/15 bg-violet-200/[.06] text-violet-200' : 'border-cyan-200/15 bg-cyan-200/[.06] text-cyan-200'}`}><Sparkles size={16} /></div><div><div className="text-sm font-semibold text-slate-200">{item.name}</div><div className="mt-0.5 text-[10px] text-slate-500">{item.kind}</div></div><StatusPill tone={item.isUp ? 'cyan' : 'muted'}>{item.isUp ? 'Above horizon' : 'Below horizon'}</StatusPill></div>
    <DataCell label="Altitude"><span className={item.isUp ? 'text-cyan-100' : 'text-slate-400'}>{fmtAltitude(item.altitude)}</span><span className="ml-1 text-[9px] text-slate-600">{item.magnitudeIsApproximate ? '≈' : ''}{item.magnitude.toFixed(1)} mag</span></DataCell>
    <DataCell label="Azimuth">{item.azimuth.toFixed(1)}° <span className="ml-1 text-[9px] text-slate-500">{item.compass}</span></DataCell>
    <DataCell label="Rise">{fmtTime(item.rise, timezone)}</DataCell><DataCell label="Transit">{fmtTime(item.transit, timezone)}{item.transitAltitude !== null && <span className="ml-1 text-[9px] text-slate-500">· {fmtAltitude(item.transitAltitude)}</span>}</DataCell><DataCell label="Set">{fmtTime(item.set, timezone)}</DataCell>
    {item.eventsError && <div className="col-span-2 text-[9px] text-amber-200/70 md:col-span-6">Event times unavailable: {item.eventsError}</div>}
  </div>;
}
function DataCell({ label, children }: { label: string; children: ReactNode }) { return <div><div className="mb-1 eyebrow !text-[8px] md:hidden">{label}</div><div className="mono text-[11px] text-slate-300">{children}</div></div>; }

function DeepSky({ snapshot, isLoading, filters }: { snapshot?: import('@workspace/api-client-react').SkySnapshot; isLoading: boolean; filters: Filters }) {
  const [query, setQuery] = useState('');
  const [visibleOnly, setVisibleOnly] = useState(false);
  const [highestFirst, setHighestFirst] = useState(true);
  const items = useMemo(() => filterDeepSky(snapshot?.messier || [], filters, visibleOnly, query).sort((a,b) => highestFirst ? b.altitude-a.altitude : a.name.localeCompare(b.name)), [snapshot?.messier, filters, visibleOnly, query, highestFirst]);
  return <div className="fade-up"><PageHeading kicker="Deep-sky catalog · Messier" title="Deep sky" sub="Search the supplied Messier catalog and focus on objects that clear your horizon and equipment limits." action={<StatusPill tone="violet"><Telescope size={12} /> M catalog</StatusPill>} />
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-300/10 bg-slate-300/[.025] p-3 sm:flex-row sm:items-center">
      <label className="relative min-w-0 flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search object or type…" className="w-full rounded-xl border border-slate-300/10 bg-[#0a111b]/80 py-2.5 pl-9 pr-3 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-200/30" data-testid="input-deep-sky-search" /></label>
      <button onClick={() => setVisibleOnly(!visibleOnly)} aria-pressed={visibleOnly} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs transition ${visibleOnly ? 'border-cyan-200/30 bg-cyan-200/[.08] text-cyan-100' : 'border-slate-300/10 text-slate-400 hover:text-slate-200'}`} data-testid="toggle-visible-only"><span className={`flex h-4 w-4 items-center justify-center rounded border ${visibleOnly ? 'border-cyan-200 bg-cyan-200 text-[#0b111b]' : 'border-slate-500'}`}>{visibleOnly && <Check size={11} />}</span>Visible only</button>
      <button onClick={() => setHighestFirst(!highestFirst)} className="flex items-center justify-center gap-2 rounded-xl border border-slate-300/10 px-3 py-2.5 text-xs text-slate-400 hover:text-slate-200" data-testid="button-sort-altitude"><ArrowDownWideNarrow size={14} className="text-violet-200" />{highestFirst ? 'Highest altitude' : 'Name A–Z'}</button>
      <Link href="/filters" className="flex items-center justify-center gap-2 rounded-xl border border-slate-300/10 px-3 py-2.5 text-xs text-slate-400 no-underline hover:text-cyan-100"><Filter size={14} />Filters</Link>
    </div>
    <div className="mb-3 flex items-center justify-between px-1"><span className="eyebrow">Catalog results</span><span className="mono text-[10px] text-slate-500">{isLoading ? '…' : `${items.length} objects shown`}</span></div>
    <DataState isLoading={isLoading} hasData={items.length > 0} emptyTitle="No objects match this search"><div className="space-y-2">{items.map(item => <DeepSkyRow item={item} key={item.name} />)}</div></DataState>
    <div className="mt-4 flex items-center gap-2 text-[10px] text-slate-600"><span className="text-violet-200">Note</span> Messier 102 is omitted in the supplied catalog source.</div>
  </div>;
}
function DeepSkyRow({ item }: { item: DeepSkyPosition }) {
  return <article className="glass grid grid-cols-[1fr_auto] gap-3 rounded-xl px-4 py-4 sm:grid-cols-[1.3fr_.8fr_.8fr_.6fr_auto] sm:items-center sm:px-5">
    <div className="flex min-w-0 items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-200/15 bg-violet-200/[.06] text-violet-200"><Telescope size={16} /></div><div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-100">{item.name}</div><div className="mt-0.5 truncate text-[10px] text-slate-500">{item.kind}</div></div></div>
    <DataCell label="Altitude"><span className="text-violet-100">{fmtAltitude(item.altitude)}</span></DataCell><DataCell label="Direction">{item.compass} <span className="text-slate-600">· {item.azimuth.toFixed(0)}°</span></DataCell><DataCell label="Magnitude">{item.magnitude.toFixed(1)}</DataCell>
    <StatusPill tone={item.isUp ? 'cyan' : 'muted'}>{item.isUp ? 'Visible' : 'Below horizon'}</StatusPill>
  </article>;
}

function Constellations({ snapshot, isLoading, filters }: { snapshot?: import('@workspace/api-client-react').SkySnapshot; isLoading: boolean; filters: Filters }) {
  const rows = useMemo(() => (snapshot?.constellations || []).filter(item => item.brightestStarAltitude >= filters.minAltitude && directionPass(item.direction, filters.direction)).sort((a,b) => b.brightestStarAltitude-a.brightestStarAltitude), [snapshot?.constellations, filters]);
  return <div className="fade-up"><PageHeading kicker="Star patterns · observer horizon" title="Constellations" sub="Visible star counts and the direction of each pattern’s brightest listed star, filtered for your observing position." action={<StatusPill><Compass size={12} /> {snapshot?.counts.constellationsVisible ?? '—'} visible</StatusPill>} />
    <div className="mb-4 grid gap-3 sm:grid-cols-2"><div className="glass flex items-center gap-3 rounded-xl p-4"><div className="rounded-lg border border-cyan-200/15 bg-cyan-200/[.06] p-2.5 text-cyan-200"><Sparkles size={16} /></div><div><div className="eyebrow">Visible patterns</div><div className="mono mt-1 text-lg text-slate-100">{snapshot?.counts.constellationsVisible ?? '—'}</div></div></div><div className="glass flex items-center gap-3 rounded-xl p-4"><div className="rounded-lg border border-violet-200/15 bg-violet-200/[.06] p-2.5 text-violet-200"><Filter size={16} /></div><div><div className="eyebrow">Active limits</div><div className="mt-1 text-xs text-slate-200">Above {filters.minAltitude}° · {filters.direction}</div></div></div></div>
    <DataState isLoading={isLoading} hasData={rows.length > 0} emptyTitle="No constellations meet these limits"><div className="mb-3 hidden grid-cols-[1.4fr_1fr_1fr_1fr] px-5 eyebrow sm:grid"><span>Pattern</span><span>Visible stars</span><span>Brightest star altitude</span><span>Direction</span></div><div className="space-y-2">{rows.map(item => <ConstellationRow item={item} key={item.name} />)}</div></DataState>
  </div>;
}
function ConstellationRow({ item }: { item: ConstellationSummary }) {
  const pct = item.totalStarCount ? Math.min(100, item.visibleStarCount / item.totalStarCount * 100) : 0;
  return <article className="glass grid grid-cols-2 gap-3 rounded-xl px-4 py-4 sm:grid-cols-[1.4fr_1fr_1fr_1fr] sm:items-center sm:px-5">
    <div className="col-span-2 flex items-center gap-3 sm:col-span-1"><div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-200/15 bg-cyan-200/[.05] text-cyan-200"><Compass size={16} /></div><div><div className="text-sm font-semibold text-slate-100">{item.name}</div><div className="mt-1 text-[10px] text-slate-500">Magnitude {item.brightestStarMagnitude.toFixed(1)} brightest star</div></div></div>
    <div><div className="mb-1 eyebrow !text-[8px] sm:hidden">Visible stars</div><div className="flex items-center gap-2"><span className="mono text-xs text-slate-200">{item.visibleStarCount}<span className="text-slate-600"> / {item.totalStarCount}</span></span><div className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-slate-500/15 sm:block"><div className="h-full rounded-full bg-cyan-200/60" style={{ width: `${pct}%` }} /></div></div></div>
    <div><div className="mb-1 eyebrow !text-[8px] sm:hidden">Brightest star altitude</div><span className="mono text-xs text-cyan-100">{fmtAltitude(item.brightestStarAltitude)}</span></div>
    <div><div className="mb-1 eyebrow !text-[8px] sm:hidden">Direction</div><span className="mono text-xs text-slate-300">{item.direction}</span></div>
  </article>;
}

function FilterPage({ filters, setFilter, setEquipment, counts }: { filters: Filters; setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void; setEquipment: (value: string) => void; counts?: import('@workspace/api-client-react').SkySnapshot['counts'] }) {
  const [saved, setSaved] = useState(false);
  const selectStyle = 'w-full rounded-xl border border-slate-300/15 bg-[#0b111b] px-3 py-3 text-sm text-slate-200 outline-none focus:border-cyan-200/35';
  const saveValue = <K extends keyof Filters>(key: K, value: Filters[K]) => { setFilter(key, value); setSaved(true); window.setTimeout(() => setSaved(false), 1600); };
  return <div className="fade-up"><PageHeading kicker="Observer setup" title="Observing filters" sub="Tune target lists to your horizon, optical setup and preferred sky direction." action={<StatusPill><Settings2 size={12} /> Saved locally</StatusPill>} />
    <div className="grid gap-4 lg:grid-cols-[1.35fr_.8fr]">
      <div className="space-y-4">
        <section className="glass rounded-2xl p-5 sm:p-6"><div className="mb-6 flex items-start gap-3"><div className="rounded-xl border border-cyan-200/15 bg-cyan-200/[.06] p-3 text-cyan-200"><Crosshair size={18} /></div><div><div className="text-sm font-semibold text-slate-100">Minimum altitude</div><p className="mt-1 text-xs leading-5 text-slate-500">Keep targets clear of trees, rooftops and atmospheric haze.</p></div><div className="mono ml-auto text-xl text-cyan-100">{filters.minAltitude}°</div></div>
          <input aria-label="Minimum altitude" type="range" min="0" max="60" step="1" value={filters.minAltitude} onChange={e => saveValue('minAltitude', Number(e.target.value))} className="w-full cursor-pointer" data-testid="range-minimum-altitude" /><div className="mt-2 flex justify-between mono text-[9px] text-slate-600"><span>0° · horizon</span><span>30°</span><span>60° · high sky</span></div>
        </section>
        <section className="glass rounded-2xl p-5 sm:p-6"><div className="flex items-start gap-3"><div className="rounded-xl border border-violet-200/15 bg-violet-200/[.06] p-3 text-violet-200"><Compass size={18} /></div><div className="flex-1"><div className="text-sm font-semibold text-slate-100">Compass / balcony direction</div><p className="mt-1 text-xs leading-5 text-slate-500">Limit results to a clear view from your observing position.</p><select value={filters.direction} onChange={e => saveValue('direction', e.target.value)} className={`${selectStyle} mt-4`} data-testid="select-direction"><option>Any direction</option>{['N','NE','E','SE','S','SW','W','NW'].map(dir => <option key={dir} value={dir}>{dir} · {compassName(dir)}</option>)}</select></div></div></section>
         <section className="glass rounded-2xl p-5 sm:p-6"><div className="flex items-start gap-3"><div className="rounded-xl border border-amber-200/15 bg-amber-200/[.06] p-3 text-amber-200"><Telescope size={18} /></div><div className="flex-1"><div className="text-sm font-semibold text-slate-100">Equipment & limiting magnitude</div><p className="mt-1 text-xs leading-5 text-slate-500">Choose an optical setup to set its practical magnitude limit, then refine it below.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label><span className="eyebrow mb-2 block !text-[9px]">Equipment</span><select value={filters.equipment} onChange={e => { setEquipment(e.target.value); setSaved(true); window.setTimeout(() => setSaved(false), 1600); }} className={selectStyle} data-testid="select-equipment">{['Naked Eye','Binoculars','Telescope'].map(item => <option key={item}>{item}</option>)}</select></label><label><span className="eyebrow mb-2 block !text-[9px]">Limiting magnitude</span><select value={filters.maxMagnitude} onChange={e => saveValue('maxMagnitude', Number(e.target.value))} className={selectStyle} data-testid="select-magnitude">{[3,4,5,6,7,8,9,10,11,12,13,14].map(num => <option key={num} value={num}>{num.toFixed(1)} mag and brighter</option>)}</select></label></div></div></div></section>
        {saved && <div role="status" className="flex items-center gap-2 text-xs text-cyan-100"><Check size={14} /> Observing limits saved on this device.</div>}
      </div>
      <aside className="space-y-4">
        <section className="glass rounded-2xl p-5"><div className="eyebrow">Filter impact</div><h2 className="mt-2 text-sm font-semibold text-slate-100">Catalog visibility</h2><p className="mt-2 text-xs leading-5 text-slate-500">Counts reflect the full current sky snapshot. Your limits refine object lists in each observing view.</p><div className="mt-5 space-y-3 border-t border-slate-300/[.08] pt-4">{[['Solar system', counts ? `${counts.solarVisible} / ${counts.solarTotal}` : '—'],['Messier catalog', counts ? `${counts.deepSkyVisible} / ${counts.deepSkyTotal}` : '—'],['Constellations', counts ? `${counts.constellationsVisible} visible` : '—']].map(([label,value]) => <div className="flex items-center justify-between text-xs" key={label}><span className="text-slate-500">{label}</span><span className="mono text-slate-200">{value}</span></div>)}</div></section>
        <section className="relative overflow-hidden rounded-2xl border border-cyan-200/15 bg-gradient-to-br from-cyan-200/[.07] to-violet-300/[.04] p-5"><div className="absolute -right-7 -top-9 h-32 w-32 rounded-full border border-cyan-100/[.06]" /><div className="eyebrow text-cyan-100/70">Observer note</div><p className="relative mt-3 text-sm leading-6 text-slate-200">A higher minimum altitude favors steadier seeing and darker air. Objects below the local horizon are never shown as visible, regardless of equipment limit.</p></section>
      </aside>
    </div>
  </div>;
}
function compassName(dir: string) { return ({ N:'North', NE:'North-east', E:'East', SE:'South-east', S:'South', SW:'South-west', W:'West', NW:'North-west' } as Record<string,string>)[dir] || dir; }

function Router() {
  return <Switch><Route path="/" component={AppFrame} /><Route path="/solar-system" component={AppFrame} /><Route path="/deep-sky" component={AppFrame} /><Route path="/constellations" component={AppFrame} /><Route path="/filters" component={AppFrame} /><Route component={NotFound} /></Switch>;
}
function App() {
  return <QueryClientProvider client={client}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter></QueryClientProvider>;
}
export default App;
