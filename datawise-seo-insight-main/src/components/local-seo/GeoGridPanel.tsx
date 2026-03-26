import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Grid3X3, Loader2, History, MapPin, Target, Sparkles } from 'lucide-react';
import { runGeoGridScan, fetchGeoGridHistory, fetchGeoGridScan, fetchGeoGridInsights } from '@/lib/local-seo';
import { getLLMConfig } from '@/lib/chat';
import type { GeoGridScanResult, GeoGridHistoryItem, LocalTrackedKeyword, GeoGridInsights } from '@/types/local-seo';
import GeoGridMap from './GeoGridMap';
import GeoGridInsightsCard from './GeoGridInsights';

interface GeoGridPanelProps {
  projectId: string;
  businessName: string | null;
  keywords: LocalTrackedKeyword[];
}

export default function GeoGridPanel({ projectId, businessName, keywords }: GeoGridPanelProps) {
  const { toast } = useToast();
  const [keyword, setKeyword] = useState('');
  const [gridSize, setGridSize] = useState('7');
  const [radiusKm, setRadiusKm] = useState('3');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<GeoGridScanResult | null>(null);
  const [history, setHistory] = useState<GeoGridHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [insights, setInsights] = useState<GeoGridInsights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);

  useEffect(() => {
    loadHistoryAndRestoreLatest();
  }, [projectId]);

  const loadHistoryAndRestoreLatest = async () => {
    setLoadingHistory(true);
    try {
      const data = await fetchGeoGridHistory(projectId);
      setHistory(data.scans);
      // Auto-load the most recent scan if none is currently displayed
      if (!scanResult && data.scans.length > 0) {
        const latest = data.scans[0];
        const result = await fetchGeoGridScan(latest.id);
        setScanResult(result);
        setKeyword(result.keyword);
        setGridSize(String(result.grid_size));
        setRadiusKm(String(result.radius_km));
      }
    } catch { /* ignore */ }
    finally { setLoadingHistory(false); }
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const data = await fetchGeoGridHistory(projectId);
      setHistory(data.scans);
    } catch { /* ignore */ }
    finally { setLoadingHistory(false); }
  };

  const handleScan = async () => {
    if (!keyword.trim()) {
      toast({ title: 'Enter a keyword', variant: 'destructive' });
      return;
    }
    setScanning(true);
    try {
      const result = await runGeoGridScan(projectId, {
        keyword: keyword.trim(),
        grid_size: parseInt(gridSize),
        radius_km: parseFloat(radiusKm),
      });
      setScanResult(result);
      setInsights(null);
      loadHistory();
      toast({
        title: 'GeoGrid scan complete',
        description: `Found in ${result.summary.found_count}/${result.points.length} locations${result.summary.avg_position ? `, avg position ${result.summary.avg_position}` : ''}`,
      });
    } catch (err) {
      toast({
        title: 'Scan failed',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setScanning(false);
    }
  };

  const handleLoadScan = async (scanId: string) => {
    try {
      const result = await fetchGeoGridScan(scanId);
      setScanResult(result);
      setInsights(null);
      setKeyword(result.keyword);
      setGridSize(String(result.grid_size));
      setRadiusKm(String(result.radius_km));
    } catch {
      toast({ title: 'Error loading scan', variant: 'destructive' });
    }
  };

  const handleGetInsights = async () => {
    if (!scanResult?.id) return;
    const llmConfig = getLLMConfig();
    if (!llmConfig?.api_key) {
      toast({
        title: 'API key required',
        description: 'Add your LLM API key in Settings to use AI recommendations.',
        variant: 'destructive',
      });
      return;
    }
    setLoadingInsights(true);
    try {
      const data = await fetchGeoGridInsights(projectId, scanResult.id, llmConfig);
      setInsights(data.insights);
    } catch (err) {
      toast({
        title: 'Could not generate recommendations',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoadingInsights(false);
    }
  };

  const totalPoints = parseInt(gridSize) * parseInt(gridSize);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Grid3X3 className="h-4 w-4" />
            GeoGrid Rank Map
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-1">
              <Label className="text-xs">Keyword</Label>
              {keywords.length > 0 ? (
                <Select value={keyword} onValueChange={setKeyword}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select keyword..." />
                  </SelectTrigger>
                  <SelectContent>
                    {keywords.map(kw => (
                      <SelectItem key={kw.id} value={kw.keyword}>{kw.keyword}</SelectItem>
                    ))}
                    <SelectItem value="__custom__">Custom keyword...</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="e.g. plumber near me"
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  className="h-9 text-sm"
                />
              )}
              {keyword === '__custom__' && (
                <Input
                  placeholder="Type keyword..."
                  value=""
                  onChange={e => setKeyword(e.target.value)}
                  className="h-9 text-sm mt-1"
                  autoFocus
                />
              )}
            </div>
            <div>
              <Label className="text-xs">Grid Size</Label>
              <Select value={gridSize} onValueChange={setGridSize}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 x 5 (25 points)</SelectItem>
                  <SelectItem value="7">7 x 7 (49 points)</SelectItem>
                  <SelectItem value="9">9 x 9 (81 points)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Radius</Label>
              <Select value={radiusKm} onValueChange={setRadiusKm}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 km</SelectItem>
                  <SelectItem value="3">3 km</SelectItem>
                  <SelectItem value="5">5 km</SelectItem>
                  <SelectItem value="10">10 km</SelectItem>
                  <SelectItem value="15">15 km</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button
                onClick={handleScan}
                disabled={scanning || !keyword.trim() || keyword === '__custom__'}
                className="h-9 flex-1"
              >
                {scanning ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Scanning {totalPoints} points...
                  </>
                ) : (
                  <>
                    <Target className="h-3.5 w-3.5 mr-1.5" />
                    Run Scan
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setShowHistory(!showHistory)}
              >
                <History className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Scan result */}
          {scanResult && (
            <div className="space-y-3">
              {/* Summary stats */}
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold">
                    {scanResult.summary.avg_position != null ? scanResult.summary.avg_position : '—'}
                  </div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Position</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-green-600">{scanResult.summary.top3_count}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Top 3</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-blue-600">{scanResult.summary.found_count}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Found</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-gray-500">{scanResult.summary.not_found_count}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Not Found</div>
                </div>
              </div>

              {/* Map */}
              <GeoGridMap
                center={scanResult.center}
                points={scanResult.points}
                businessName={businessName}
              />

              <p className="text-[10px] text-muted-foreground text-center">
                Keyword: "{scanResult.keyword}" | {scanResult.grid_size}x{scanResult.grid_size} grid | {scanResult.radius_km}km radius | Scanned: {new Date(scanResult.scanned_at).toLocaleString()}
              </p>

              {/* AI Insights button */}
              {!insights && !loadingInsights && (
                <div className="flex justify-center pt-2">
                  <Button variant="outline" onClick={handleGetInsights} className="gap-2">
                    <Sparkles className="h-4 w-4" />
                    Get AI Recommendations
                  </Button>
                </div>
              )}
              {loadingInsights && (
                <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing your visibility...
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!scanResult && !scanning && (
            <div className="text-center py-12 text-muted-foreground">
              <MapPin className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Run a GeoGrid scan</p>
              <p className="text-xs mt-1">
                See how your business ranks across different locations on Google Maps
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Insights */}
      {insights && <GeoGridInsightsCard insights={insights} />}

      {/* History panel */}
      {showHistory && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <History className="h-4 w-4" />
              Scan History
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingHistory ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No scans yet</p>
            ) : (
              <div className="space-y-1">
                {history.map(scan => (
                  <button
                    key={scan.id}
                    onClick={() => handleLoadScan(scan.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left hover:bg-muted/50 transition-colors ${
                      scanResult?.id === scan.id ? 'bg-muted' : ''
                    }`}
                  >
                    <div>
                      <div className="text-sm font-medium">{scan.keyword}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {scan.grid_size}x{scan.grid_size} | {scan.radius_km}km | {new Date(scan.scanned_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold">
                        {scan.avg_position != null ? `#${scan.avg_position}` : '—'}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {scan.found_count}/{scan.grid_size * scan.grid_size} found | {scan.top3_count} top 3
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
