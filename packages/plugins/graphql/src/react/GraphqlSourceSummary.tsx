export default function GraphqlSourceSummary(props: {
  sourceId: string;
  variant?: "badge" | "panel";
}) {
  if (props.variant === "panel") return null;
  return <span>GraphQL · {props.sourceId}</span>;
}
