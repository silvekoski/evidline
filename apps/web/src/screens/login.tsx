import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export function LoginScreen() {
  const [email, setEmail] = useState("demo@silvekoski.com");
  const [password, setPassword] = useState("demo");

  const handleMicrosoftLogin = () => {
    toast.error("Organization login has been disabled in the demo environment.");
  };

  const handleLogin = (event: FormEvent) => {
    event.preventDefault();
    window.location.assign("/");
  };

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Log in</CardTitle>
          <CardDescription>Use the demo account below.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleLogin}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-email">Email</Label>
              <Input id="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <Button type="submit" className="w-full">
              Login
            </Button>
            <button type="button" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
              Forgot your password?
            </button>
            <div className="flex items-center gap-2">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">Organization login</span>
              <Separator className="flex-1" />
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={handleMicrosoftLogin}>
              <svg viewBox="0 0 21 21" className="size-4" aria-hidden="true">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Log in with Microsoft
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Demo credentials: demo@silvekoski.com / demo</p>
    </main>
  );
}
