import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarClock, MapPin, RefreshCw, CalendarDays, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, addWeeks, addMonths, format } from 'date-fns';
import PlacesAutocomplete from './PlacesAutocomplete';
import MapPreview from './MapPreview';
import { Calendar } from '@/components/ui/calendar';

type Meeting = {
  id: string;
  meeting_index: number;
  meeting_at: string;
  location_text: string | null;
  location_lat: number | null;
  location_lon: number | null;
};

interface Props {
  seasonId: string;
  meetingType: 'remote' | 'in_person';
  allowEdit?: boolean;
}

const MeetingScheduleManager = ({ seasonId, meetingType, allowEdit = false }: Props) => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('19:00');
  const [editLocation, setEditLocation] = useState('');
  const [editCoords, setEditCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [intervalUnit, setIntervalUnit] = useState<'days' | 'weeks' | 'months'>('weeks');
  const [intervalValue, setIntervalValue] = useState(1);
  const [applyAfterIndex, setApplyAfterIndex] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<'recurring' | 'single'>('recurring');
  const [firstMeetingDate, setFirstMeetingDate] = useState('');
  const [firstMeetingTime, setFirstMeetingTime] = useState('19:00');
  const [sameLocation, setSameLocation] = useState(true);
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingCoords, setMeetingCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [meetingPlaces, setMeetingPlaces] = useState<{ text: string; lat?: number; lon?: number }[]>([]);
  const meetingsToSchedule = 6;
  const [singleMeetingDate, setSingleMeetingDate] = useState('');
  const [singleMeetingTime, setSingleMeetingTime] = useState('19:00');
  const [singleMeetingLocation, setSingleMeetingLocation] = useState('');
  const [singleMeetingCoords, setSingleMeetingCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [addCount, setAddCount] = useState(3);
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(undefined);

  const sortedMeetings = useMemo(
    () => [...meetings].sort((a, b) => a.meeting_index - b.meeting_index),
    [meetings]
  );

  const fetchMeetings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('club_meetings')
        .select('*')
        .eq('season_id', seasonId)
        .order('meeting_index', { ascending: true });
      if (error) throw error;
      setMeetings((data || []) as Meeting[]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load meetings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMeetings();
  }, [seasonId]);

  const buildMeetingDates = () => {
    if (!firstMeetingDate || !firstMeetingTime) return [];
    const [hour, minute] = firstMeetingTime.split(':').map((v) => Number.parseInt(v, 10));
    const start = new Date(`${firstMeetingDate}T00:00:00`);
    start.setHours(Number.isFinite(hour) ? hour : 19, Number.isFinite(minute) ? minute : 0, 0, 0);
    const dates: Date[] = [];
    for (let i = 0; i < meetingsToSchedule; i += 1) {
      if (i === 0) {
        dates.push(new Date(start));
      } else if (intervalUnit === 'days') {
        dates.push(addDays(start, intervalValue * i));
      } else if (intervalUnit === 'weeks') {
        dates.push(addWeeks(start, intervalValue * i));
      } else {
        dates.push(addMonths(start, intervalValue * i));
      }
    }
    return dates;
  };

  const meetingDates = buildMeetingDates();

  useEffect(() => {
    if (meetingDates.length === 0) return;
    setMeetingPlaces((prev) => {
      const next = [...prev];
      while (next.length < meetingDates.length) {
        next.push({ text: '' });
      }
      return next.slice(0, meetingDates.length);
    });
  }, [firstMeetingDate, firstMeetingTime, intervalUnit, intervalValue]);

  useEffect(() => {
    if (!sameLocation) {
      setMeetingPlaces((prev) => {
        if (prev.length === 0) return prev;
        if (prev[0]?.text) return prev;
        return [
          {
            text: meetingLocation,
            lat: meetingCoords?.lat,
            lon: meetingCoords?.lon,
          },
          ...prev.slice(1),
        ];
      });
    }
  }, [sameLocation, meetingLocation, meetingCoords?.lat, meetingCoords?.lon]);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data } = await supabase
          .from('meeting_settings')
          .select('interval_value, interval_unit')
          .eq('season_id', seasonId)
          .maybeSingle();
        if (data?.interval_unit) {
          setIntervalUnit(data.interval_unit as 'days' | 'weeks' | 'months');
          setIntervalValue(data.interval_value);
        }
      } catch {
        // ignore
      }
    };
    fetchSettings();
  }, [seasonId]);

  const startEdit = (meeting: Meeting) => {
    const date = new Date(meeting.meeting_at);
    setEditingId(meeting.id);
    setEditDate(date.toISOString().slice(0, 10));
    setEditTime(date.toTimeString().slice(0, 5));
    setEditLocation(meeting.location_text || '');
    if (meeting.location_lat && meeting.location_lon) {
      setEditCoords({ lat: Number(meeting.location_lat), lon: Number(meeting.location_lon) });
    } else {
      setEditCoords(null);
    }
  };

  const saveEdit = async () => {
    if (!editingId || !editDate || !editTime) return;
    setLoading(true);
    try {
      const date = new Date(`${editDate}T00:00:00`);
      const [hour, minute] = editTime.split(':').map((v) => Number.parseInt(v, 10));
      date.setHours(Number.isFinite(hour) ? hour : 19, Number.isFinite(minute) ? minute : 0, 0, 0);
      const { error } = await supabase
        .from('club_meetings')
        .update({
          meeting_at: date.toISOString(),
          location_text: meetingType === 'in_person' ? (editLocation.trim() || null) : null,
          location_lat: meetingType === 'in_person' ? (editCoords?.lat ?? null) : null,
          location_lon: meetingType === 'in_person' ? (editCoords?.lon ?? null) : null,
        })
        .eq('id', editingId);
      if (error) throw error;
      toast.success('Meeting updated');
      setEditingId(null);
      await fetchMeetings();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update meeting');
    } finally {
      setLoading(false);
    }
  };

  const generateDates = (start: Date, count: number) => {
    const dates: Date[] = [];
    for (let i = 1; i <= count; i += 1) {
      if (intervalUnit === 'days') dates.push(addDays(start, intervalValue * i));
      else if (intervalUnit === 'weeks') dates.push(addWeeks(start, intervalValue * i));
      else dates.push(addMonths(start, intervalValue * i));
    }
    return dates;
  };

  const appendMeetings = async (count: number) => {
    if (count <= 0 || sortedMeetings.length === 0) return;
    const last = sortedMeetings[sortedMeetings.length - 1];
    const lastDate = new Date(last.meeting_at);
    const futureDates = generateDates(lastDate, count);
    setLoading(true);
    try {
      const rows = futureDates.map((date, idx) => ({
        season_id: seasonId,
        meeting_index: last.meeting_index + idx + 1,
        meeting_at: date.toISOString(),
        location_text: meetingType === 'in_person' ? last.location_text : null,
        location_lat: meetingType === 'in_person' ? last.location_lat : null,
        location_lon: meetingType === 'in_person' ? last.location_lon : null,
      }));
      const { error } = await supabase.from('club_meetings').insert(rows);
      if (error) throw error;
      toast.success(`Added ${count} meetings`);
      await fetchMeetings();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add meetings');
    } finally {
      setLoading(false);
    }
  };

  const applyFrequencyChange = async () => {
    if (!applyAfterIndex || sortedMeetings.length === 0) return;
    const anchor = sortedMeetings.find((m) => m.meeting_index === applyAfterIndex);
    if (!anchor) return;
    setLoading(true);
    try {
      const total = sortedMeetings.length;
      const remaining = total - applyAfterIndex;
      const anchorDate = new Date(anchor.meeting_at);
      const futureDates = generateDates(anchorDate, remaining);

      await supabase
        .from('club_meetings')
        .delete()
        .eq('season_id', seasonId)
        .gt('meeting_index', applyAfterIndex);

      if (futureDates.length > 0) {
        const rows = futureDates.map((date, idx) => ({
          season_id: seasonId,
          meeting_index: applyAfterIndex + idx + 1,
          meeting_at: date.toISOString(),
          location_text: meetingType === 'in_person' ? anchor.location_text : null,
          location_lat: meetingType === 'in_person' ? anchor.location_lat : null,
          location_lon: meetingType === 'in_person' ? anchor.location_lon : null,
        }));
        const { error } = await supabase.from('club_meetings').insert(rows);
        if (error) throw error;
      }

      await supabase
        .from('meeting_settings')
        .update({ interval_value: intervalValue, interval_unit: intervalUnit })
        .eq('season_id', seasonId);

      toast.success('Frequency updated for future meetings');
      await fetchMeetings();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update frequency');
    } finally {
      setLoading(false);
    }
  };

  const renderSingleMeetingForm = (onSaved?: () => void) => (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Input type="date" value={singleMeetingDate} onChange={(e) => setSingleMeetingDate(e.target.value)} className="bg-muted/50" />
        <Input type="time" value={singleMeetingTime} onChange={(e) => setSingleMeetingTime(e.target.value)} className="bg-muted/50" />
      </div>
      {meetingType === 'in_person' && (
        <div className="space-y-2">
          <PlacesAutocomplete
            value={singleMeetingLocation}
            onChange={setSingleMeetingLocation}
            placeholder="Search for a place..."
            onPlaceSelected={(place) => {
              setSingleMeetingLocation(place.name || place.display_name);
              setSingleMeetingCoords({ lat: Number(place.lat), lon: Number(place.lon) });
            }}
          />
          {singleMeetingCoords && (
            <MapPreview lat={singleMeetingCoords.lat} lon={singleMeetingCoords.lon} label={singleMeetingLocation} />
          )}
        </div>
      )}
      <Button
        variant="gold"
        size="sm"
        disabled={!singleMeetingDate || !singleMeetingTime || loading}
        onClick={async () => {
          setLoading(true);
          try {
            const [hour, minute] = singleMeetingTime.split(':').map((v) => Number.parseInt(v, 10));
            const date = new Date(`${singleMeetingDate}T00:00:00`);
            date.setHours(Number.isFinite(hour) ? hour : 19, Number.isFinite(minute) ? minute : 0, 0, 0);
            const nextIndex = sortedMeetings.length > 0 ? Math.max(...sortedMeetings.map(m => m.meeting_index)) + 1 : 1;
            const { error } = await supabase.from('club_meetings').insert({
              season_id: seasonId,
              meeting_index: nextIndex,
              meeting_at: date.toISOString(),
              location_text: meetingType === 'in_person' ? (singleMeetingLocation.trim() || null) : null,
              location_lat: meetingType === 'in_person' ? (singleMeetingCoords?.lat ?? null) : null,
              location_lon: meetingType === 'in_person' ? (singleMeetingCoords?.lon ?? null) : null,
            });
            if (error) throw error;
            toast.success('Meeting added');
            setSingleMeetingDate('');
            setSingleMeetingTime('19:00');
            setSingleMeetingLocation('');
            setSingleMeetingCoords(null);
            await fetchMeetings();
            onSaved?.();
          } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to add meeting');
          } finally {
            setLoading(false);
          }
        }}
      >
        Add meeting
      </Button>
    </div>
  );

  if (sortedMeetings.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-primary" />
          <h3 className="font-display text-lg font-bold">Meeting schedule</h3>
        </div>
        <p className="text-sm text-muted-foreground mt-2">No meetings scheduled yet.</p>
        <div className="mt-3">
          {allowEdit && !showCreate ? (
            <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
              Create meeting schedule
            </Button>
          ) : allowEdit ? (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={createMode === 'recurring' ? 'gold' : 'outline'}
                  size="sm"
                  onClick={() => setCreateMode('recurring')}
                >
                  Automatic recurring
                </Button>
                <Button
                  variant={createMode === 'single' ? 'gold' : 'outline'}
                  size="sm"
                  onClick={() => setCreateMode('single')}
                >
                  One at a time
                </Button>
              </div>
              {createMode === 'single' ? (
                renderSingleMeetingForm(() => setShowCreate(false))
              ) : (
                <>
              <div className="flex flex-wrap gap-2 items-end">
                <Select value={intervalUnit} onValueChange={(v) => setIntervalUnit(v as typeof intervalUnit)}>
                  <SelectTrigger className="w-32 bg-muted/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="days">Days</SelectItem>
                    <SelectItem value="weeks">Weeks</SelectItem>
                    <SelectItem value="months">Months</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={String(intervalValue)} onValueChange={(v) => setIntervalValue(Number(v))}>
                  <SelectTrigger className="w-24 bg-muted/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(intervalUnit === 'days' ? [1, 2, 3, 4, 5, 6]
                      : intervalUnit === 'weeks' ? [1, 2, 3]
                      : [1, 2]
                    ).map((val) => (
                      <SelectItem key={val} value={String(val)}>{val}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground mb-2">per meeting</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input type="date" value={firstMeetingDate} onChange={(e) => setFirstMeetingDate(e.target.value)} className="bg-muted/50" />
                <Input type="time" value={firstMeetingTime} onChange={(e) => setFirstMeetingTime(e.target.value)} className="bg-muted/50" />
              </div>

              {meetingType === 'in_person' && (
                <div className="space-y-2">
                  <PlacesAutocomplete
                    value={meetingLocation}
                    onChange={setMeetingLocation}
                    placeholder="Search for a place..."
                    onPlaceSelected={(place) => {
                      setMeetingLocation(place.name || place.display_name);
                      setMeetingCoords({ lat: Number(place.lat), lon: Number(place.lon) });
                    }}
                  />
                  {meetingCoords && (
                    <MapPreview lat={meetingCoords.lat} lon={meetingCoords.lon} label={meetingLocation} />
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={sameLocation}
                      onChange={(e) => setSameLocation(e.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="text-xs text-muted-foreground">All meetings at the same location</span>
                  </div>
                </div>
              )}

              {meetingType === 'in_person' && !sameLocation && meetingDates.length > 0 && (
                <div className="space-y-2">
                  {meetingDates.map((date, idx) => (
                    <div key={idx} className="rounded-xl border border-border p-3 bg-muted/10 space-y-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Meeting {idx + 1}</span>
                        <span>{format(date, 'EEE, MMM d · h:mm a')}</span>
                      </div>
                      <PlacesAutocomplete
                        value={meetingPlaces[idx]?.text || ''}
                        onChange={(val) => {
                          setMeetingPlaces((prev) => {
                            const next = [...prev];
                            next[idx] = { ...next[idx], text: val };
                            return next;
                          });
                        }}
                        placeholder="Search for a place..."
                        onPlaceSelected={(place) => {
                          setMeetingPlaces((prev) => {
                            const next = [...prev];
                            next[idx] = { text: place.name || place.display_name, lat: Number(place.lat), lon: Number(place.lon) };
                            return next;
                          });
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="gold"
                  size="sm"
                  disabled={!firstMeetingDate || !firstMeetingTime || loading}
                  onClick={async () => {
                    setLoading(true);
                    try {
                      await supabase.from('meeting_settings').insert({
                        season_id: seasonId,
                        interval_value: intervalValue,
                        interval_unit: intervalUnit,
                        same_location: sameLocation,
                      });

                      const meetings = meetingDates.map((date, idx) => {
                        let locationText: string | null = null;
                        let locationLat: number | null = null;
                        let locationLon: number | null = null;
                        if (meetingType === 'in_person') {
                          if (sameLocation) {
                            locationText = meetingLocation.trim() || null;
                            locationLat = meetingCoords?.lat ?? null;
                            locationLon = meetingCoords?.lon ?? null;
                          } else {
                            const place = meetingPlaces[idx];
                            locationText = place?.text?.trim() || null;
                            locationLat = place?.lat ?? null;
                            locationLon = place?.lon ?? null;
                          }
                        }
                        return {
                          season_id: seasonId,
                          meeting_index: idx + 1,
                          meeting_at: date.toISOString(),
                          location_text: locationText,
                          location_lat: locationLat,
                          location_lon: locationLon,
                        };
                      });

                      if (meetings.length > 0) {
                        const { error } = await supabase.from('club_meetings').insert(meetings);
                        if (error) throw error;
                      }
                      toast.success('Meeting schedule created');
                      setShowCreate(false);
                      await fetchMeetings();
                    } catch (err: unknown) {
                      toast.error(err instanceof Error ? err.message : 'Failed to create meeting schedule');
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  Save schedule
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
              </div>
                </>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">Ask your admin to add meetings.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-primary" />
          <h3 className="font-display text-lg font-bold">Meeting schedule</h3>
        </div>
        {allowEdit && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowCalendar(!showCalendar)}>
            <CalendarDays className="w-4 h-4 mr-1" /> {showCalendar ? 'List view' : 'Calendar'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="w-4 h-4 mr-1" /> {showCreate ? 'Close' : 'Add meeting'}
          </Button>
        </div>
        )}
      </div>

      {showCalendar && (
        <div className="rounded-xl border border-border bg-muted/10 p-3 mb-3">
          <Calendar
            mode="single"
            selected={selectedDay}
            onSelect={setSelectedDay}
            modifiers={{
              meeting: sortedMeetings.map((m) => new Date(m.meeting_at)),
            }}
            modifiersClassNames={{
              meeting: 'bg-primary/20 text-primary font-semibold',
            }}
          />
          {selectedDay && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                {format(selectedDay, 'EEE, MMM d')}
              </p>
              {sortedMeetings.filter((m) => {
                const d = new Date(m.meeting_at);
                return d.toDateString() === selectedDay.toDateString();
              }).map((m) => (
                <div key={m.id} className="rounded-lg border border-border bg-card/50 p-2 text-sm">
                  Meeting {m.meeting_index} · {format(new Date(m.meeting_at), 'h:mm a')}
                  {meetingType === 'in_person' && m.location_text && (
                    <span className="text-xs text-muted-foreground"> · {m.location_text}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {allowEdit && showCreate && (
          <div className="rounded-xl border border-border bg-muted/10 p-3 space-y-3">
            <p className="text-sm font-medium">Add a meeting</p>
            {renderSingleMeetingForm(() => setShowCreate(false))}
          </div>
        )}
        {sortedMeetings.map((meeting) => {
          const date = new Date(meeting.meeting_at);
          const isEditing = editingId === meeting.id;
          return (
            <div key={meeting.id} className="rounded-xl border border-border bg-card/50 p-3">
              {!isEditing ? (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Meeting {meeting.meeting_index}</p>
                    <p className="text-xs text-muted-foreground">{format(date, 'EEE, MMM d · h:mm a')}</p>
                    {meetingType === 'in_person' && meeting.location_text && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <MapPin className="w-3 h-3" /> {meeting.location_text}
                      </p>
                    )}
                  </div>
                  {allowEdit && (
                    <Button variant="outline" size="sm" onClick={() => startEdit(meeting)} disabled={loading}>
                      Edit
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="bg-muted/50" />
                    <Input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} className="bg-muted/50" />
                  </div>
                  {meetingType === 'in_person' && (
                    <div className="space-y-2">
                      <PlacesAutocomplete
                        value={editLocation}
                        onChange={setEditLocation}
                        placeholder="Search for a place..."
                        onPlaceSelected={(place) => {
                          setEditLocation(place.name || place.display_name);
                          setEditCoords({ lat: Number(place.lat), lon: Number(place.lon) });
                        }}
                      />
                      {editCoords && (
                        <MapPreview lat={editCoords.lat} lon={editCoords.lon} label={editLocation} />
                      )}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button variant="gold" size="sm" onClick={saveEdit} disabled={loading}>
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {allowEdit && (
      <div className="mt-4 border-t border-border/60 pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" />
          <p className="text-sm font-medium">Create next meetings</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={String(addCount)} onValueChange={(v) => setAddCount(Number(v))}>
            <SelectTrigger className="w-28 bg-muted/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5, 6].map((val) => (
                <SelectItem key={val} value={String(val)}>{val}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => appendMeetings(addCount)} disabled={loading || sortedMeetings.length === 0}>
            Add meetings
          </Button>
          <span className="text-xs text-muted-foreground">Uses current frequency and last meeting as the anchor.</span>
        </div>
      </div>
      )}

      {allowEdit && (
      <div className="mt-5 border-t border-border/60 pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-primary" />
          <p className="text-sm font-medium">Change frequency after meeting</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={applyAfterIndex ? String(applyAfterIndex) : ''} onValueChange={(v) => setApplyAfterIndex(Number(v))}>
            <SelectTrigger className="w-40 bg-muted/50">
              <SelectValue placeholder="After meeting #" />
            </SelectTrigger>
            <SelectContent>
              {sortedMeetings.map((m) => (
                <SelectItem key={m.id} value={String(m.meeting_index)}>After #{m.meeting_index}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={intervalUnit} onValueChange={(v) => setIntervalUnit(v as typeof intervalUnit)}>
            <SelectTrigger className="w-32 bg-muted/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="days">Days</SelectItem>
              <SelectItem value="weeks">Weeks</SelectItem>
              <SelectItem value="months">Months</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(intervalValue)} onValueChange={(v) => setIntervalValue(Number(v))}>
            <SelectTrigger className="w-24 bg-muted/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(intervalUnit === 'days' ? [1, 2, 3, 4, 5, 6]
                : intervalUnit === 'weeks' ? [1, 2, 3]
                : [1, 2]
              ).map((val) => (
                <SelectItem key={val} value={String(val)}>{val}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={applyFrequencyChange} disabled={loading || !applyAfterIndex}>
            Apply
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Changing frequency regenerates future meetings only. Edited meeting dates stay as-is.
        </p>
      </div>
      )}
    </div>
  );
};

export default MeetingScheduleManager;
