using System.Text.Json;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Api;

public static class EntityMappers
{
    public static ProjectDto ToDto(this Project p) =>
        new(p.Id, p.Name, p.DateRegistered.ToString("yyyy-MM-dd"), p.Owner, p.Status);

    public static PartDto ToDto(this Part p) =>
        new(
            p.Id,
            p.ProjectId,
            p.Aircraft,
            p.No,
            p.PartNumber,
            p.PartDescription,
            p.Picture,
            p.Qpa,
            p.FirstLaunchQty,
            p.FirstDelivery,
            p.MaterialSpec,
            p.FinishThickness,
            p.FinishWidth,
            p.FinishLength,
            p.MaterialRulingDim,
            p.MaterialThickness,
            p.MaterialWidth,
            p.MaterialLength,
            p.QtyPerBillet,
            p.SetupTimeHour,
            p.CycleTurnMill,
            p.Cycle3x,
            p.Cycle4x,
            p.Cycle5x,
            p.CycleTotalHrs);

    public static UserDto ToDto(this User u) =>
        new(u.Id, u.Username, u.Password, u.DisplayName, u.Status);

    public static MaterialSpecDto ToDto(this MaterialSpec m) =>
        new(
            m.Id,
            m.Specification,
            m.GeneralName,
            m.MaterialType,
            m.Density,
            m.CreatedBy,
            m.CreatedDate.ToString("yyyy-MM-dd"),
            m.Status);

    public static MachineProfileDto ToDto(this MachineProfile m) =>
        new(
            m.Id,
            m.Name,
            m.AxisTypes,
            m.RapidRateMmpm,
            m.SpindlePowerKw,
            m.AccelDecelFactor,
            m.ToolChangeTimeSec,
            m.CreatedBy,
            m.CreatedDate.ToString("yyyy-MM-dd"),
            m.Status);

    public static OperationTemplateDto ToDto(this OperationTemplate t)
    {
        object parameters = new { };
        if (!string.IsNullOrWhiteSpace(t.ParamsJson))
        {
            try
            {
                parameters = JsonSerializer.Deserialize<object>(t.ParamsJson) ?? new { };
            }
            catch
            {
                parameters = new { };
            }
        }

        return new OperationTemplateDto(
            t.Id,
            t.Name,
            t.OperationType,
            parameters,
            t.CreatedBy,
            t.CreatedDate.ToString("yyyy-MM-dd"),
            t.Status);
    }
}
