import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { MapPin, Loader2, Search } from 'lucide-react';
import { loadGoogleMaps } from '@/lib/googleMaps';

interface Place {
  place_id: string;
  name: string;
  description: string;
  main_text: string;
  secondary_text: string;
  lat?: number;
  lon?: number;
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
  const serviceRef = useRef<any>(null);
  const detailsRef = useRef<any>(null);

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
      await loadGoogleMaps();
      if (!serviceRef.current) {
        serviceRef.current = new (window as any).google.maps.places.AutocompleteService();
      }
      serviceRef.current.getPlacePredictions(
        { input: q, types: ['establishment', 'geocode'] },
        (predictions: any[]) => {
          const items = (predictions || []).slice(0, 6).map((p: any) => ({
            place_id: p.place_id,
            name: p.structured_formatting?.main_text || p.description,
            description: p.description,
            main_text: p.structured_formatting?.main_text || p.description,
            secondary_text: p.structured_formatting?.secondary_text || '',
          }));
          setResults(items);
          setShowDropdown(true);
          setLoading(false);
        }
      );
    } catch {
      setResults([]);
      setLoading(false);
    }
  };

  const handleInputChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchPlaces(val), 400);
  };

  const selectPlace = async (place: Place) => {
    setQuery(place.description);
    onChange(place.description);
    try {
      await loadGoogleMaps();
      if (!detailsRef.current) {
        const dummy = document.createElement('div');
        detailsRef.current = new (window as any).google.maps.places.PlacesService(dummy);
      }
      detailsRef.current.getDetails(
        { placeId: place.place_id, fields: ['name', 'geometry', 'formatted_address', 'address_components'] },
        (details: any) => {
          if (details?.geometry?.location) {
            const lat = details.geometry.location.lat();
            const lon = details.geometry.location.lng();
            const components = details.address_components || [];
            const get = (type: string) => components.find((c: any) => c.types.includes(type))?.short_name;
            const streetNumber = get('street_number');
            const route = get('route');
            const city = get('locality') || get('postal_town') || get('administrative_area_level_2');
            const state = get('administrative_area_level_1');
            const street = [streetNumber, route].filter(Boolean).join(' ');
            const shortAddress = [street, city, state].filter(Boolean).join(', ');

            const name = details.name || place.name;
            const formatted = details.formatted_address || place.description;
            const formattedShort = formatted
              ? formatted.split(',').slice(0, 3).map((p: string) => p.trim()).filter(Boolean).join(', ')
              : '';
            const addressPart = shortAddress || formattedShort || formatted;
            const display = name && addressPart && !addressPart.startsWith(name)
              ? `${name}, ${addressPart}`
              : (addressPart || name || place.description);

            setQuery(display);
            onChange(display);
            onPlaceSelected?.({
              ...place,
              name,
              description: display,
              lat,
              lon,
            });
          } else {
            onPlaceSelected?.(place);
          }
        }
      );
    } catch {
      onPlaceSelected?.(place);
    } finally {
      setShowDropdown(false);
    }
  };

  const formatPlaceName = (place: Place) => {
    return { main: place.main_text, sub: place.secondary_text };
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
            Powered by Google Maps
          </p>
        </div>
      )}
    </div>
  );
};

export default PlacesAutocomplete;
