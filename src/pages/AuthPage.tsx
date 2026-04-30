import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popcorn } from 'lucide-react';
import logo from '@/assets/logo.png';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { authSchema, getSafeErrorMessage } from '@/lib/security';

const AuthPage = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = authSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      if (isSignUp) {
        await signUp(parsed.data.email, parsed.data.password);
        toast.success('Account created! Check your email to confirm.');
      } else {
        await signIn(parsed.data.email, parsed.data.password);
        navigate('/dashboard');
      }
    } catch (err: unknown) {
      toast.error(getSafeErrorMessage(err, 'Authentication failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* Ambient glows */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full bg-primary/5 blur-[140px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-primary/3 blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="glass-card rounded-2xl p-8 w-full max-w-md mx-4 relative z-10"
        style={{ boxShadow: '0 0 60px -20px hsl(38 90% 55% / 0.12), 0 32px 64px -12px rgba(0,0,0,0.6)' }}
      >
        <div className="text-center mb-8">
          <div className="relative inline-block mb-4">
            <div className="absolute inset-0 rounded-2xl blur-xl bg-primary/15 scale-110" />
            <img src={logo} alt="Movie Club Hub" className="h-16 object-contain rounded-2xl relative mix-blend-screen" />
          </div>
          <h1 className="text-3xl font-display font-bold text-gradient-gold">Movie Club Hub</h1>
          <p className="text-muted-foreground mt-2 flex items-center justify-center gap-1.5 text-sm">
            <Popcorn className="w-4 h-4" />
            Your private screening room
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="bg-muted/40 border-border/60 focus:border-primary/50 transition-colors h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              className="bg-muted/40 border-border/60 focus:border-primary/50 transition-colors h-11"
            />
          </div>
          <Button type="submit" variant="gold" className="w-full h-11 text-base" disabled={loading}>
            {loading ? 'Loading...' : isSignUp ? 'Create Account' : 'Sign In'}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default AuthPage;
