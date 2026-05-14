import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSearchParams } from 'react-router-dom';
import KeywordOverview from './KeywordOverview';
import RelatedKeywords from './RelatedKeywords';
import KeywordSuggestions from './KeywordSuggestions';
import KeywordIdeas from './KeywordIdeas';
import KeywordDifficulty from './KeywordDifficulty';
import PeopleAlsoAsk from './PeopleAlsoAsk';
import FanOutQueries from './FanOutQueries';

const keywordResearchTabs = new Set([
  'overview',
  'related',
  'suggestions',
  'ideas',
  'difficulty',
  'people-also-ask',
  'fan-out',
]);

export default function KeywordResearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab = requestedTab && keywordResearchTabs.has(requestedTab) ? requestedTab : 'overview';

  function handleTabChange(value: string) {
    const nextParams = new URLSearchParams(searchParams);

    if (value === 'overview') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', value);
    }

    setSearchParams(nextParams, { replace: true });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Keyword Research</h1>
        <p className="text-muted-foreground">Comprehensive keyword analysis tools</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="inline-flex h-auto max-w-full flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="related">Related</TabsTrigger>
          <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
          <TabsTrigger value="ideas">Ideas</TabsTrigger>
          <TabsTrigger value="difficulty">Difficulty</TabsTrigger>
          <TabsTrigger value="people-also-ask">People Also Ask</TabsTrigger>
          <TabsTrigger value="fan-out">Fan-out Queries</TabsTrigger>
        </TabsList>

        <TabsContent forceMount value="overview" className="mt-6">
          <KeywordOverview />
        </TabsContent>
        <TabsContent forceMount value="related" className="mt-6">
          <RelatedKeywords />
        </TabsContent>
        <TabsContent forceMount value="suggestions" className="mt-6">
          <KeywordSuggestions />
        </TabsContent>
        <TabsContent forceMount value="ideas" className="mt-6">
          <KeywordIdeas />
        </TabsContent>
        <TabsContent forceMount value="difficulty" className="mt-6">
          <KeywordDifficulty />
        </TabsContent>
        <TabsContent forceMount value="people-also-ask" className="mt-6">
          <PeopleAlsoAsk />
        </TabsContent>
        <TabsContent forceMount value="fan-out" className="mt-6">
          <FanOutQueries />
        </TabsContent>
      </Tabs>
    </div>
  );
}
