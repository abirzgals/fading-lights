import * as ex from 'excalibur';
import { ResourceType } from '../types';

/**
 * Makes an entity a harvestable resource (tree, stone, metal).
 * Tracks hit count and drop type.
 */
export class ResourceComponent extends ex.Component {
  public readonly type = 'Resource';

  public resourceType: ResourceType;
  public dropAmount: number;

  constructor(resourceType: ResourceType, dropAmount: number) {
    super();
    this.resourceType = resourceType;
    this.dropAmount = dropAmount;
  }
}
