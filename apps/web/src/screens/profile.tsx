import { type ChangeEvent, type FormEvent, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { demoUser } from "@/lib/demo-user";
import { useProfilePhoto } from "@/hooks/use-profile-photo";
import { maxProfilePhotoBytes, setProfilePhoto } from "@/lib/profile-photo";

export function ProfileScreen() {
  const [name, setName] = useState(demoUser.name);
  const [email, setEmail] = useState(demoUser.email);
  const [role, setRole] = useState(demoUser.role);
  const [bio, setBio] = useState(demoUser.bio);
  const [productUpdates, setProductUpdates] = useState(false);
  const photoUrl = useProfilePhoto();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const handleChangePhoto = () => {
    photoInputRef.current?.click();
  };

  const handlePhotoSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file.");
      return;
    }
    if (file.size > maxProfilePhotoBytes) {
      toast.error("Choose an image under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProfilePhoto(reader.result as string);
      toast.success("Photo updated.");
    };
    reader.onerror = () => toast.error("The file did not load.");
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    setProfilePhoto(null);
  };

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    toast.success("Profile saved.");
  };

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 py-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile settings</CardTitle>
          <CardDescription>Manage the demo account details.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-5" onSubmit={handleSave}>
            <div className="flex items-center gap-3">
              <UserAvatar name={name} photoUrl={photoUrl} className="size-14 text-lg" />
              <div className="flex gap-2">
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={handlePhotoSelected}
                />
                <Button type="button" variant="outline" size="sm" onClick={handleChangePhoto}>
                  Change photo
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={handleRemovePhoto} disabled={!photoUrl}>
                  Remove
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="profile-name">Full name</Label>
              <Input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="profile-email">Email</Label>
              <Input id="profile-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="profile-role">Role</Label>
              <Input id="profile-role" value={role} onChange={(event) => setRole(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="profile-bio">Bio</Label>
              <Textarea id="profile-bio" value={bio} onChange={(event) => setBio(event.target.value)} />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <span className="flex flex-col items-start gap-0.5 text-sm">
                Email notifications
                <span className="text-xs text-muted-foreground">Select which run events send an email.</span>
              </span>
              <Button asChild type="button" variant="outline" size="sm">
                <Link to="/notifications">Manage</Link>
              </Button>
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="profile-product-updates" className="flex flex-col items-start gap-0.5 font-normal">
                Product updates
                <span className="text-xs font-normal text-muted-foreground">Hear about new features once a month.</span>
              </Label>
              <Switch id="profile-product-updates" checked={productUpdates} onCheckedChange={setProductUpdates} />
            </div>
            <Button type="submit" className="w-full">
              Save changes
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
