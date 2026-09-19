import { Button } from "@/components/Button";
import { Numeral } from "@/components/Numeral";
import { Board, Panel } from "@/components/Panel";

export default function IssueNotFound() {
  return (
    <Board>
      <Panel label="Not found">
        <div className="flex flex-col gap-6">
          <Numeral value="404" size="d100" ghost label="Error 404" />
          <h1 className="type-display m-0 text-j3 md:text-j4">No issue at this address</h1>
          <p className="measure m-0 text-body">
            Either it never went out or the link got mangled on the way to the group chat. Every issue that did go out is in the archive.
          </p>
          <div>
            <Button href="/newsletter" variant="secondary">
              Every issue
            </Button>
          </div>
        </div>
      </Panel>
    </Board>
  );
}
