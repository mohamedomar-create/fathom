"use client";
import { DirectionProvider } from "@radix-ui/react-direction";
import { createContext, useContext } from "react";
import { dict, dirOf, type Lang } from ".";

const LangContext = createContext<Lang>("en");

/** Gives client components the language chosen on the server, so both render the same words. */
export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}><DirectionProvider dir={dirOf(lang)}>{children}</DirectionProvider></LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);
export const useDict = () => dict(useContext(LangContext));
