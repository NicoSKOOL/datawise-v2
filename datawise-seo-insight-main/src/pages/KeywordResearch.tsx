import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import KeywordOverview from './KeywordOverview';
import RelatedKeywords from './RelatedKeywords';
import KeywordSuggestions from './KeywordSuggestions';
import KeywordIdeas from './KeywordIdeas';
import KeywordDifficulty from './KeywordDifficulty';

export default function KeywordResearch() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Keyword Research</h1>
        <p className="text-muted-foreground">Comprehensive keyword analysis tools</p>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="related">Related</TabsTrigger>
          <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
          <TabsTrigger value="ideas">Ideas</TabsTrigger>
          <TabsTrigger value="difficulty">Difficulty</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <KeywordOverview />
        </TabsContent>
        <TabsContent value="related" className="mt-6">
          <RelatedKeywords />
        </TabsContent>
        <TabsContent value="suggestions" className="mt-6">
          <KeywordSuggestions />
        </TabsContent>
        <TabsContent value="ideas" className="mt-6">
          <KeywordIdeas />
        </TabsContent>
        <TabsContent value="difficulty" className="mt-6">
          <KeywordDifficulty />
        </TabsContent>
      </Tabs>
    </div>
  );
}
