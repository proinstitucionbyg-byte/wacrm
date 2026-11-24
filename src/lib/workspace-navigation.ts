/** Highlight exactly the most specific real route, without matching partial names. */
export function activeWorkspacePath(pathname: string, paths: readonly string[]): string | null {
  return paths.filter(path=>pathname===path||pathname.startsWith(path+'/')).sort((a,b)=>b.length-a.length)[0]??null;
}
