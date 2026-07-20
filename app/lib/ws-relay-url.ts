type RelayLocation = Readonly<{
  protocol: string;
  host: string;
}>;

export const buildWsRelayUrl = (
  location: RelayLocation,
  query: URLSearchParams,
): string => {
  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
  return `${wsProtocol}://${location.host}/ws?${query.toString()}`;
};
