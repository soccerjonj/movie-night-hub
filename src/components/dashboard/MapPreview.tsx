import { ExternalLink } from 'lucide-react';

interface Props {
  lat: number;
  lon: number;
  label?: string;
}

const MapPreview = ({ lat, lon, label }: Props) => {
  const center = `${lat},${lon}`;
  const mapUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`;
  const imageUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=${encodeURIComponent(center)}&zoom=15&size=640x320&markers=${encodeURIComponent(center)},red-pushpin`;

  return (
    <div className="rounded-xl border border-border bg-card/50 overflow-hidden">
      <img src={imageUrl} alt={label ? `Map of ${label}` : 'Map preview'} className="w-full h-44 sm:h-52 object-cover" />
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          {label && <p className="text-sm font-medium truncate">{label}</p>}
          <p className="text-xs text-muted-foreground truncate">{lat.toFixed(5)}, {lon.toFixed(5)}</p>
        </div>
        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open map
        </a>
      </div>
    </div>
  );
};

export default MapPreview;
