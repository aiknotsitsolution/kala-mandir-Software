import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format12h } from "@/lib/format";

/** All 15-minute marks of the day as "HH:mm" (storage stays 24h). */
const TIMES = (() => {
    const out = [];
    for (let m = 0; m < 24 * 60; m += 15) {
        out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
    }
    return out;
})();

/**
 * Time picker dropdown that always DISPLAYS the 12-hour clock with AM/PM
 * ("1:00 PM", never "14:00") while storing "HH:mm" for the API.
 */
export function TimeSelect({ value, onValueChange, id, ariaLabel, className, disabled, times }) {
    const options = times ?? TIMES;
    return (<Select value={value ?? ""} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={className}>
        <SelectValue placeholder="Select time"/>
      </SelectTrigger>
      <SelectContent>
        {options.map((t) => (<SelectItem key={t} value={t}>
            {format12h(t)}
          </SelectItem>))}
      </SelectContent>
    </Select>);
}
