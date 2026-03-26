import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate, useNavigate } from 'react-router-dom';
import { TimelineContent } from '@/components/ui/timeline-animation';
import NumberFlow from '@number-flow/react';
import { CheckCheck, Users, Sparkles, ExternalLink, Infinity } from 'lucide-react';
import { useRef } from 'react';
import { type Variants } from 'motion/react';

const Index = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const heroRef = useRef<HTMLDivElement>(null);

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const revealVariants: Variants = {
    visible: (i: number) => ({
      y: 0,
      opacity: 1,
      filter: "blur(0px)",
      transition: {
        delay: i * 0.3,
        duration: 0.5,
      },
    }),
    hidden: {
      filter: "blur(10px)",
      y: -20,
      opacity: 0,
    },
  };

  const plans = [
    {
      name: "AI Ranking Member",
      description: "Unlimited access for AI Ranking Community members",
      icon: <Users className="h-8 w-8" />,
      popular: true,
      features: [
        { text: "Unlimited tool uses", icon: <Infinity size={20} /> },
        { text: "Priority support", icon: <CheckCheck size={20} /> },
        { text: "Exclusive community access", icon: <CheckCheck size={20} /> },
      ],
      includes: [
        "Full access includes:",
        "Keyword research & tracking",
        "Competitor analysis",
        "AI-powered insights",
        "Real-time rank monitoring",
      ],
      buttonText: "Sign In / Sign Up",
      secondaryButton: "Join Community",
      buttonAction: () => navigate('/auth'),
      secondaryAction: () => window.open('https://www.skool.com/ai-ranking', '_blank'),
    },
    {
      name: "Free Trial",
      description: "Test our tools with 5 free uses - no approval needed",
      icon: <Sparkles className="h-8 w-8" />,
      uses: 5,
      features: [
        { text: "5 free tool uses", icon: <CheckCheck size={20} /> },
        { text: "Instant access - no waiting", icon: <CheckCheck size={20} /> },
        { text: "Full access to all SEO tools", icon: <CheckCheck size={20} /> },
      ],
      includes: [
        "Trial includes:",
        "Keyword research",
        "Rank tracking",
        "Competitor analysis",
        "SEO insights",
      ],
      buttonText: "Start Free Trial",
      buttonAction: () => navigate('/auth'),
    },
  ];

  return (
    <div className="px-4 pt-20 min-h-screen mx-auto relative bg-neutral-50" ref={heroRef}>
      <div
        className="absolute top-0 left-[10%] right-[10%] w-[80%] h-full z-0"
        style={{
          backgroundImage: `radial-gradient(circle at center, hsl(var(--primary)) 0%, transparent 70%)`,
          opacity: 0.15,
          mixBlendMode: "multiply",
        }}
      />

      <div className="text-center mb-8 max-w-4xl mx-auto relative z-10">
        <TimelineContent
          as="h1"
          animationNum={0}
          timelineRef={heroRef}
          customVariants={revealVariants}
          className="md:text-6xl sm:text-5xl text-4xl font-bold text-foreground mb-6"
        >
          Professional SEO Tools
        </TimelineContent>

        <TimelineContent
          as="p"
          animationNum={1}
          timelineRef={heroRef}
          customVariants={revealVariants}
          className="text-xl text-muted-foreground mb-4"
        >
          Powered by{" "}
          <TimelineContent
            as="span"
            animationNum={1}
            timelineRef={heroRef}
            customVariants={revealVariants}
            className="border border-dashed border-primary px-2 py-1 rounded-xl bg-primary/10 font-semibold inline-block"
          >
            DataForSEO
          </TimelineContent>
        </TimelineContent>

        <TimelineContent
          as="p"
          animationNum={2}
          timelineRef={heroRef}
          customVariants={revealVariants}
          className="text-lg text-muted-foreground"
        >
          Built for the AI Ranking Community
        </TimelineContent>
      </div>

      <div className="grid md:grid-cols-2 max-w-5xl gap-6 py-8 mx-auto relative z-10">
        {plans.map((plan, index) => (
          <TimelineContent
            key={plan.name}
            as="div"
            animationNum={3 + index}
            timelineRef={heroRef}
            customVariants={revealVariants}
          >
            <Card
              className={`relative border-2 transition-all hover:shadow-xl ${
                plan.popular
                  ? "ring-2 ring-primary bg-primary/5 border-primary/50"
                  : "bg-card border-border hover:border-primary/30"
              }`}
            >
              <CardHeader className="text-left">
                <div className="flex justify-between items-start mb-4">
                  <div className="text-primary">{plan.icon}</div>
                  {plan.popular && (
                    <span className="bg-primary text-primary-foreground px-3 py-1 rounded-full text-sm font-semibold shadow-lg">
                      Unlimited
                    </span>
                  )}
                  {plan.uses && (
                    <span className="bg-secondary text-secondary-foreground px-3 py-1 rounded-full text-sm font-semibold">
                      <NumberFlow value={plan.uses} className="font-semibold" /> uses
                    </span>
                  )}
                </div>
                <h2 className="text-3xl font-bold text-foreground mb-2">
                  {plan.name}
                </h2>
                <p className="text-sm text-muted-foreground mb-6">{plan.description}</p>
              </CardHeader>

              <CardContent className="pt-0">
                <Button
                  size="lg"
                  className={`w-full mb-4 text-lg h-12 shadow-lg ${
                    plan.popular
                      ? "bg-primary hover:bg-primary/90"
                      : ""
                  }`}
                  onClick={plan.buttonAction}
                >
                  {plan.buttonText}
                </Button>

                {plan.secondaryButton && (
                  <Button
                    size="lg"
                    variant="outline"
                    className="w-full mb-6 text-lg h-12"
                    onClick={plan.secondaryAction}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {plan.secondaryButton}
                  </Button>
                )}

                <ul className="space-y-3 font-medium py-5 border-t border-border">
                  {plan.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-center">
                      <span className="text-primary grid place-content-center mt-0.5 mr-3">
                        {feature.icon}
                      </span>
                      <span className="text-sm text-foreground">
                        {feature.text}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="space-y-3 pt-4 border-t border-border">
                  <h4 className="font-semibold text-base text-foreground mb-3">
                    {plan.includes[0]}
                  </h4>
                  <ul className="space-y-2">
                    {plan.includes.slice(1).map((feature, featureIndex) => (
                      <li key={featureIndex} className="flex items-center">
                        <span className="h-6 w-6 bg-primary/10 border border-primary rounded-full grid place-content-center mt-0.5 mr-3 flex-shrink-0">
                          <CheckCheck className="h-4 w-4 text-primary" />
                        </span>
                        <span className="text-sm text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TimelineContent>
        ))}
      </div>
    </div>
  );
};

export default Index;
