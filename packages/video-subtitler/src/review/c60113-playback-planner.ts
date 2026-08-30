import {
  c60113IntervalUnion,
  c60113UnplayedIntervals,
  type C60113PlaybackInterval,
} from "./c60113-review-workspace.js";

export interface C60113PlayableRegion {
  regionId: string;
  itemIds: string[];
  contextInterval: C60113PlaybackInterval;
  audioSourceInterval: C60113PlaybackInterval;
}
export interface C60113PlayableSegment {
  segmentId: string;
  sourceInterval: C60113PlaybackInterval;
  playbackRegionId: string;
  regionIds: string[];
  itemIds: string[];
  audioSeekStart: number;
  audioSeekEnd: number;
}

/** Compile selected risk contexts, not the broader frozen union component membership. */
export function planC60113PlayableSegments(input: {
  regions: C60113PlayableRegion[];
  playedIntervals?: C60113PlaybackInterval[];
}): C60113PlayableSegment[] {
  if (
    new Set(input.regions.map((region) => region.regionId)).size !==
    input.regions.length
  )
    throw new Error("DUPLICATE_PLAYBACK_REGION");
  for (const region of input.regions) {
    c60113IntervalUnion([region.contextInterval, region.audioSourceInterval]);
    if (
      region.audioSourceInterval.start > region.contextInterval.start ||
      region.audioSourceInterval.end < region.contextInterval.end
    )
      throw new Error("PLAYBACK_CLIP_DOES_NOT_COVER_REGION");
  }
  const requested = c60113IntervalUnion(
    input.regions.map((region) => region.contextInterval),
  ).flatMap((interval) =>
    c60113UnplayedIntervals(interval, input.playedIntervals ?? []),
  );
  const result: C60113PlayableSegment[] = [];
  for (const interval of requested) {
    let cursor = interval.start;
    while (cursor < interval.end - 1e-9) {
      const covering = input.regions
        .filter(
          (region) =>
            region.audioSourceInterval.start <= cursor + 1e-9 &&
            region.audioSourceInterval.end > cursor + 1e-9,
        )
        .sort(
          (a, b) =>
            b.audioSourceInterval.end - a.audioSourceInterval.end ||
            a.regionId.localeCompare(b.regionId),
        );
      const chosen = covering[0];
      if (!chosen) throw new Error("PLAYBACK_UNCOVERED_SOURCE_INTERVAL");
      const end = Math.min(interval.end, chosen.audioSourceInterval.end);
      const related = input.regions.filter(
        (region) =>
          region.regionId === chosen.regionId ||
          (region.contextInterval.start < end &&
            region.contextInterval.end > cursor),
      );
      result.push({
        segmentId: `runtime-playback-${result.length + 1}`,
        sourceInterval: { start: cursor, end },
        playbackRegionId: chosen.regionId,
        regionIds: related.map((region) => region.regionId).sort(),
        itemIds: [
          ...new Set(related.flatMap((region) => region.itemIds)),
        ].sort(),
        audioSeekStart: Math.max(0, cursor - chosen.audioSourceInterval.start),
        audioSeekEnd: end - chosen.audioSourceInterval.start,
      });
      cursor = end;
    }
  }
  return result;
}

/** Tested against the typed planner; emitted without evaluation or a browser dependency. */
export function c60113PlaybackPlannerJavascript(): string {
  return String.raw`
function planC60113PlayableSegments(input){
 const union=values=>{const out=[];for(const p of [...values].sort((a,b)=>a.start-b.start||a.end-b.end)){if(!Number.isFinite(p.start)||!Number.isFinite(p.end)||p.start<0||p.end<=p.start)throw new Error('INVALID_PLAYBACK_INTERVAL');const previous=out.at(-1);if(previous&&p.start<=previous.end+1e-9)previous.end=Math.max(previous.end,p.end);else out.push({...p})}return out};
 const remaining=source=>{let cursor=source.start;const out=[];for(const p of union(input.playedIntervals??[])){if(p.end<=cursor||p.start>=source.end)continue;if(p.start>cursor)out.push({start:cursor,end:Math.min(p.start,source.end)});cursor=Math.max(cursor,p.end)}if(cursor<source.end)out.push({start:cursor,end:source.end});return out};
 if(new Set(input.regions.map(region=>region.regionId)).size!==input.regions.length)throw new Error('DUPLICATE_PLAYBACK_REGION');
 for(const region of input.regions){union([region.contextInterval,region.audioSourceInterval]);if(region.audioSourceInterval.start>region.contextInterval.start||region.audioSourceInterval.end<region.contextInterval.end)throw new Error('PLAYBACK_CLIP_DOES_NOT_COVER_REGION')}
 const requested=union(input.regions.map(region=>region.contextInterval)).flatMap(remaining),result=[];
 for(const interval of requested){let cursor=interval.start;while(cursor<interval.end-1e-9){const covering=input.regions.filter(region=>region.audioSourceInterval.start<=cursor+1e-9&&region.audioSourceInterval.end>cursor+1e-9).sort((a,b)=>b.audioSourceInterval.end-a.audioSourceInterval.end||a.regionId.localeCompare(b.regionId)),chosen=covering[0];if(!chosen)throw new Error('PLAYBACK_UNCOVERED_SOURCE_INTERVAL');const end=Math.min(interval.end,chosen.audioSourceInterval.end),related=input.regions.filter(region=>region.regionId===chosen.regionId||region.contextInterval.start<end&&region.contextInterval.end>cursor);result.push({segmentId:'runtime-playback-'+(result.length+1),sourceInterval:{start:cursor,end},playbackRegionId:chosen.regionId,regionIds:related.map(region=>region.regionId).sort(),itemIds:[...new Set(related.flatMap(region=>region.itemIds))].sort(),audioSeekStart:Math.max(0,cursor-chosen.audioSourceInterval.start),audioSeekEnd:end-chosen.audioSourceInterval.start});cursor=end}}
 return result;
}
`;
}
