import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Users, CalendarClock, Play, Settings, ChevronRight, X, Sparkles } from 'lucide-react';
import { ClubLabels } from '@/lib/clubTypes';

interface Props {
  groupId: string;
  labels: ClubLabels;
  onDismiss: () => void;
}

const steps = (labels: ClubLabels) => [
  {
    icon: <Users className="w-8 h-8" />,
    title: 'Add Your Members',
    description: `Open the ⚙️ Settings panel and use the "Members" dropdown to add placeholder names for everyone in your club. Then share the join code so they can claim their spot.`,
  },
  {
    icon: <Sparkles className="w-8 h-8" />,
    title: 'Create a Season',
    description: `Click "New Season" in the admin panel to start your first season. You'll choose participants, set a theme, and configure ${labels.watching} intervals.`,
  },
  {
    icon: <CalendarClock className="w-8 h-8" />,
    title: 'Schedule Meetings',
    description: `During the ${labels.watching} phase, use "Set Call Date" to schedule your next meeting. You can change the date anytime from the admin panel.`,
  },
  {
    icon: <Play className="w-8 h-8" />,
    title: 'Manage the Season',
    description: `Use the ⚙️ button in the top bar to open admin tools. From there you can advance ${labels.items}, reveal picks, edit schedules, and move between phases.`,
  },
];

const AdminWalkthrough = ({ groupId, labels, onDismiss }: Props) => {
  const [currentStep, setCurrentStep] = useState(0);
  const allSteps = steps(labels);

  const handleDismiss = () => {
    localStorage.setItem(`walkthrough_dismissed_${groupId}`, 'true');
    onDismiss();
  };

  const handleNext = () => {
    if (currentStep < allSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleDismiss();
    }
  };

  const step = allSteps[currentStep];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <motion.div
        key={currentStep}
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ duration: 0.3 }}
        className="glass-card rounded-2xl p-8 max-w-md w-full relative"
      >
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-3 right-3 h-8 w-8 text-muted-foreground"
          onClick={handleDismiss}
        >
          <X className="w-4 h-4" />
        </Button>

        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary">
            {step.icon}
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">
              Step {currentStep + 1} of {allSteps.length}
            </p>
            <h2 className="text-xl font-display font-bold">{step.title}</h2>
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {step.description}
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-1.5 mt-6">
          {allSteps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === currentStep ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30'
              }`}
            />
          ))}
        </div>

        <div className="flex gap-3 mt-6">
          <Button variant="ghost" className="flex-1" onClick={handleDismiss}>
            Skip
          </Button>
          <Button variant="gold" className="flex-1" onClick={handleNext}>
            {currentStep < allSteps.length - 1 ? (
              <>Next <ChevronRight className="w-4 h-4 ml-1" /></>
            ) : (
              "Got it!"
            )}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default AdminWalkthrough;
