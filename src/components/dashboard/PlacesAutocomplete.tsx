import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { MapPin, Loader2, Search } from 'lucide-react';

interface Place {
  display_name: string;
  name: string;
  type: string;
  lat: string;
  lon: string;
  address: {
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country?: string;
    [key: string]: string | undefined;
  };
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelected?: (place: Place) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

const PlacesAutocomplete = ({ value, onChange, onPlaceSelected, placeholder = 'Search for a place...', autoFocus }: Props) => {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const searchPlaces = async (q: string) => {
    if (q.trim().length < 3) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=6`,
        { headers: { 'Accept': 'application/json' } }
      );
      const data = await res.json();
      setResults(data as Place[]);
      setShowDropdown(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchPlaces(val), 400);
  };

  const selectPlace = (place: Place) => {
    const city = place.address?.city || place.address?.town || place.address?.village || '';
    const short = place.name && city
      ? `${place.name}, ${city}`
      : place.display_name.split(',').slice(0, 3).join(',').trim();
    setQuery(short);
    onChange(short);
    onPlaceSelected?.(place);
    setShowDropdown(false);
  };

  const formatPlaceName = (place: Place) => {
    const parts = place.display_name.split(',');
    const main = parts[0]?.trim();
    const sub = parts.slice(1, 3).join(',').trim();
    return { main, sub };
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="bg-muted/50 border-border pl-9"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {showDropdown && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-xl shadow-lg overflow-hidden max-h-[260px] overflow-y-auto">
          {results.map((place, i) => {
            const { main, sub } = formatPlaceName(place);
            return (
              <button
                key={i}
                type="button"
                onClick={() => selectPlace(place)}
                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors flex items-start gap-2.5 border-b border-border/50 last:border-0"
              >
                <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{main}</p>
                  {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
                </div>
              </button>
            );
          })}
          <p className="text-[10px] text-muted-foreground/50 text-center py-1">
            Powered by OpenStreetMap
          </p>
        </div>
      )}
    </div>
  );
};

export default PlacesAutocomplete;
