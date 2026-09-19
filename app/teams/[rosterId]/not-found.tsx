import { Button } from "@/components/Button";
import { Numeral } from "@/components/Numeral";
import { Board, Panel } from "@/components/Panel";

export default function TeamNotFound() {
  return (
    <Board>
      <Panel label="No such team">
        <div className="flex flex-col gap-6">
          <Numeral value="404" size="d100" ghost label="Error 404" />
          <h1 className="type-display m-0 text-j3 md:text-j4">No team here</h1>
          <p className="measure m-0">The league has ten teams and this link points at none of them. Maybe it got relegated.</p>
          <div className="flex flex-wrap gap-3">
            <Button href="/teams" variant="secondary">
              All ten teams
            </Button>
            <Button href="/draft" variant="secondary">
              Draft board
            </Button>
          </div>
        </div>
      </Panel>
    </Board>
  );
}
