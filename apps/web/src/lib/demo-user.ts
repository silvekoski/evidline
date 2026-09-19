export const demoUser = {
  name: "Teemu Testikäyttäjä",
  email: "demo@silvekoski.com",
  role: "Chief button clicker",
  bio: "Clicks every button twice, just to make sure it still works.",
};

export function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
